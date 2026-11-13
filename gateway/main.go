package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/pprof"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"edgeproxy/gateway/acme"
	"edgeproxy/gateway/protocol"
	"edgeproxy/gateway/proxy"
)

type AgentHandshakePayload struct {
	Subdomain string `json:"subdomain"`
	Token     string `json:"token"`
	Version   string `json:"version"`
}

func main() {
	httpPort := flag.Int("http-port", 80, "Public HTTP ingress port")
	tlsPort := flag.Int("tls-port", 443, "Public HTTPS ingress port with SNI TLS termination")
	tunnelPort := flag.Int("tunnel-port", 4242, "Tunnel port for local agents")
	baseDomain := flag.String("domain", "edgeproxy.mesh", "Base wildcard domain for tunnels")
	rateLimitRps := flag.Float64("rps", 100.0, "Per-IP allowed RPS before rate limiting")
	burstCapacity := flag.Float64("burst", 150.0, "Maximum burst capacity for token bucket")
	internalAddr := flag.String("internal-addr", envOrDefault("EDGEPROXY_INTERNAL_ADDR", "127.0.0.1:8081"), "Private control-plane IPC address")
	internalSecret := flag.String("internal-secret", os.Getenv("EDGEPROXY_INTERNAL_SECRET"), "Shared secret for private control-plane IPC (required to enable it)")
	certDir := flag.String("cert-dir", "./certs", "Directory for TLS certificates")
	tunnelTLS := flag.Bool("tunnel-tls", false, "Enable TLS on the tunnel listener")
	tunnelCert := flag.String("tunnel-cert", "", "Path to PEM certificate for the tunnel listener (defaults to generated self-signed)")
	tunnelKey := flag.String("tunnel-key", "", "Path to PEM private key for the tunnel listener")
	tunnelCA := flag.String("tunnel-ca", "", "Path to CA bundle to verify agent client certificates (optional, enables mTLS)")
	tunnelMaxConns := flag.Int("tunnel-max-conns", 1024, "Maximum concurrent agent tunnel connections")
	flag.Parse()

	if *internalSecret != "" && len(*internalSecret) < 24 {
		log.Fatalf("[FATAL] EDGEPROXY_INTERNAL_SECRET must be at least 24 characters")
	}
	if _, _, err := net.SplitHostPort(*internalAddr); err != nil {
		log.Fatalf("[FATAL] Invalid -internal-addr %q: %v", *internalAddr, err)
	}

	log.Printf("==========================================================")
	log.Printf("  EdgeProxy Gateway - Go network infrastructure (vpn.how)")
	log.Printf("  Base Domain: *.%s", *baseDomain)
	log.Printf("  Ingress Ports: HTTP :%d | HTTPS :%d | Tunnel :%d (tls=%t)", *httpPort, *tlsPort, *tunnelPort, *tunnelTLS)
	log.Printf("  Shield: TokenBucket %.0f RPS / %.0f Burst", *rateLimitRps, *burstCapacity)
	log.Printf("  TLS: Self-signed ECDSA P-256 with SNI on :%d (not publicly trusted)", *tlsPort)
	log.Printf("  Internal IPC: %s (secret configured: %t)", *internalAddr, *internalSecret != "")
	log.Printf("  Runtime: Go %s, GOMAXPROCS=%d", runtime.Version(), runtime.GOMAXPROCS(0))
	log.Printf("==========================================================")

	router := proxy.NewRouter(*baseDomain, *rateLimitRps, *burstCapacity)
	certMgr := acme.NewCertManager(*baseDomain, *certDir)

	var internalServer *http.Server
	if *internalSecret != "" {
		internalMux := http.NewServeMux()
		setupInternalHandlers(internalMux, router, certMgr)
		// Observability + profiling, gated behind the same shared-secret auth.
		internalMux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			writeMetrics(w, router)
		})
		internalMux.HandleFunc("/debug/pprof/", pprof.Index)
		internalMux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
		internalMux.HandleFunc("/debug/pprof/profile", pprof.Profile)
		internalMux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
		internalMux.HandleFunc("/debug/pprof/trace", pprof.Trace)

		internalServer = &http.Server{
			Addr:              *internalAddr,
			Handler:           internalAuth(*internalSecret, internalMux),
			ReadHeaderTimeout: 5 * time.Second,
			ReadTimeout:       10 * time.Second,
			WriteTimeout:      10 * time.Second,
			IdleTimeout:       60 * time.Second,
		}
		go func() {
			log.Printf("[INTERNAL] Listening on %s (shared-secret auth)", *internalAddr)
			if err := internalServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Printf("[WARN] Internal IPC server error: %v", err)
			}
		}()
	} else {
		log.Printf("[INTERNAL] Disabled: EDGEPROXY_INTERNAL_SECRET is not set")
	}

	// Tunnel listener. Optional TLS for the multiplexed agent wire.
	var tunnelListener net.Listener
	var err error
	tunnelAddr := fmt.Sprintf("0.0.0.0:%d", *tunnelPort)
	if *tunnelTLS {
		tlsCfg, err := buildTunnelTLSConfig(*tunnelCert, *tunnelKey, *tunnelCA, certMgr)
		if err != nil {
			log.Fatalf("[FATAL] Tunnel TLS config: %v", err)
		}
		tunnelListener, err = tls.Listen("tcp", tunnelAddr, tlsCfg)
	} else {
		tunnelListener, err = net.Listen("tcp", tunnelAddr)
	}
	if err != nil {
		log.Fatalf("[FATAL] Failed to bind tunnel port %d: %v", *tunnelPort, err)
	}

	// Connection semaphore to cap resource usage under load.
	sem := make(chan struct{}, *tunnelMaxConns)
	var tunnelWG sync.WaitGroup

	go func() {
		log.Printf("[TUNNEL-INGRESS] Listening for incoming Agent connections on :%d (tls=%t, maxConns=%d)", *tunnelPort, *tunnelTLS, *tunnelMaxConns)
		for {
			conn, err := tunnelListener.Accept()
			if err != nil {
				if errors.Is(err, net.ErrClosed) {
					return
				}
				log.Printf("[TUNNEL-INGRESS] Accept error: %v", err)
				continue
			}
			// Backpressure on connection acceptance: drop when saturated.
			select {
			case sem <- struct{}{}:
			default:
				log.Printf("[TUNNEL-INGRESS] Connection limit reached, rejecting %s", conn.RemoteAddr())
				_ = conn.Close()
				continue
			}
			tunnelWG.Add(1)
			go func(c net.Conn) {
				defer func() {
					<-sem
					tunnelWG.Done()
				}()
				// Socket tuning for the accepted connection.
				if tcpConn, ok := c.(*net.TCPConn); ok {
					_ = tcpConn.SetKeepAlive(true)
					_ = tcpConn.SetKeepAlivePeriod(30 * time.Second)
					_ = tcpConn.SetNoDelay(true)
				}
				handleAgentConnection(router, c)
			}(conn)
		}
	}()

	// Public HTTP server.
	httpServer := &http.Server{
		Addr:              fmt.Sprintf(":%d", *httpPort),
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	go func() {
		log.Printf("[HTTP-INGRESS] Listening on :%d", *httpPort)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("[WARN] HTTP server error: %v", err)
		}
	}()

	// HTTPS server with SNI-based TLS termination.
	tlsServer := &http.Server{
		Addr:              fmt.Sprintf(":%d", *tlsPort),
		Handler:           router,
		TLSConfig:         certMgr.TLSConfig(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	go func() {
		log.Printf("[HTTPS-INGRESS] Starting TLS termination on :%d (self-signed SNI)", *tlsPort)
		if err := tlsServer.ListenAndServeTLS("", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("[WARN] HTTPS server error (port %d may require elevated privileges): %v", *tlsPort, err)
		}
	}()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	<-sigChan

	log.Println("[SHUTDOWN] Gracefully shutting down EdgeProxy Gateway...")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
	_ = tlsServer.Shutdown(ctx)
	if internalServer != nil {
		_ = internalServer.Shutdown(ctx)
	}
	_ = tunnelListener.Close()
	// Wait for in-flight tunnel connections to finish (bounded by context).
	done := make(chan struct{})
	go func() { tunnelWG.Wait(); close(done) }()
	select {
	case <-done:
	case <-ctx.Done():
		log.Println("[SHUTDOWN] Tunnel connections did not drain in time")
	}
	log.Println("[SHUTDOWN] Complete")
}

func buildTunnelTLSConfig(certFile, keyFile, caFile string, certMgr *acme.CertManager) (*tls.Config, error) {
	cfg := &tls.Config{
		MinVersion: tls.VersionTLS12,
		NextProtos: []string{"edgeproxy-tunnel/1"},
	}
	if certFile != "" && keyFile != "" {
		cert, err := tls.LoadX509KeyPair(certFile, keyFile)
		if err != nil {
			return nil, fmt.Errorf("load keypair: %w", err)
		}
		cfg.Certificates = []tls.Certificate{cert}
	} else {
		cert, err := certMgr.GetCertificate(&tls.ClientHelloInfo{ServerName: certMgr.BaseDomain()})
		if err != nil {
			return nil, fmt.Errorf("no tunnel cert available: %w", err)
		}
		cfg.Certificates = []tls.Certificate{*cert}
	}
	if caFile != "" {
		caPEM, err := os.ReadFile(caFile)
		if err != nil {
			return nil, fmt.Errorf("read CA bundle: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(caPEM) {
			return nil, fmt.Errorf("failed to parse CA bundle")
		}
		cfg.ClientCAs = pool
		cfg.ClientAuth = tls.RequireAndVerifyClientCert
	}
	return cfg, nil
}

func handleAgentConnection(router *proxy.Router, conn net.Conn) {
	defer conn.Close()

	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))

	frame, err := protocol.ReadFrame(conn)
	if err != nil {
		log.Printf("[AGENT-HANDSHAKE] Failed reading handshake frame: %v", err)
		return
	}

	if frame.Type != protocol.FrameSyn {
		log.Printf("[AGENT-HANDSHAKE] Expected SYN frame, received 0x%02x", frame.Type)
		return
	}

	var handshake AgentHandshakePayload
	payloadStr := strings.TrimSpace(string(frame.Payload))

	if strings.HasPrefix(payloadStr, "{") {
		if err := json.Unmarshal(frame.Payload, &handshake); err != nil {
			log.Printf("[AGENT-HANDSHAKE] Invalid JSON handshake: %v", err)
			return
		}
	} else {
		handshake.Subdomain = payloadStr
	}

	handshake.Subdomain = strings.ToLower(strings.TrimSpace(handshake.Subdomain))
	if !proxy.ValidSubdomain(handshake.Subdomain) {
		log.Printf("[AGENT-HANDSHAKE] Invalid subdomain %q", handshake.Subdomain)
		return
	}

	if !router.VerifyAuthorization(handshake.Subdomain, handshake.Token) {
		log.Printf("[AGENT-AUTH-REJECTED] Unauthorized agent connection for subdomain '%s'", handshake.Subdomain)
		rstFrame := &protocol.Frame{
			StreamID: 0,
			Type:     protocol.FrameRst,
			Payload:  []byte("HTTP 401: Unauthorized tunnel agent token"),
		}
		_, _ = conn.Write(rstFrame.Encode())
		return
	}

	_ = conn.SetDeadline(time.Time{})

	session := router.RegisterSession(handshake.Subdomain, conn)
	defer router.UnregisterSession(handshake.Subdomain)

	session.WriterLock.Lock()
	_, _ = session.Conn.Write((&protocol.Frame{
		StreamID: 0,
		Type:     protocol.FrameAck,
		Payload:  []byte(`{"status":"ready"}`),
	}).Encode())
	session.WriterLock.Unlock()

	for {
		f, err := protocol.ReadFrame(conn)
		if err != nil {
			log.Printf("[AGENT] Session %s disconnected: %v", session.ID, err)
			break
		}

		switch f.Type {
		case protocol.FramePing:
			session.WriterLock.Lock()
			_, _ = session.Conn.Write((&protocol.Frame{
				StreamID: f.StreamID,
				Type:     protocol.FramePong,
			}).Encode())
			session.WriterLock.Unlock()

		case protocol.FrameMetrics:
			router.RecordTelemetry(handshake.Subdomain, f.Payload)

		case protocol.FrameFin:
			session.StreamsMu.Lock()
			ch, exists := session.Streams[f.StreamID]
			delete(session.Streams, f.StreamID)
			session.StreamsMu.Unlock()
			if exists && ch != nil {
				select {
				case ch <- f.Payload:
				default:
				}
				close(ch)
			}

		case protocol.FrameData:
			session.StreamsMu.RLock()
			ch, exists := session.Streams[f.StreamID]
			session.StreamsMu.RUnlock()

			if exists && ch != nil {
				select {
				case ch <- f.Payload:
				case <-time.After(500 * time.Millisecond):
					log.Printf("[AGENT-BACKPRESSURE] Stream %d channel saturated, backpressure active", f.StreamID)
				}
			}
		}
	}
}

func envOrDefault(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func internalAuth(secret string, next http.Handler) http.Handler {
	expected := sha256.Sum256([]byte(secret))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		presented := r.Header.Get("X-EdgeProxy-Internal")
		actual := sha256.Sum256([]byte(presented))
		if presented == "" || subtle.ConstantTimeCompare(expected[:], actual[:]) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func setupInternalHandlers(mux *http.ServeMux, router *proxy.Router, certMgr *acme.CertManager) {
	mux.HandleFunc("/internal/certs", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(certMgr.ListCertificates())
	})

	mux.HandleFunc("/internal/certs/issue", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var req struct {
			Domain   string `json:"domain"`
			Wildcard bool   `json:"wildcard"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		meta, err := certMgr.IssueOrRenew(req.Domain, req.Wildcard)
		if err != nil {
			http.Error(w, "certificate issuance failed", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(meta)
	})

	mux.HandleFunc("/internal/sessions", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(router.GetActiveSessionsSnapshot())
	})

	mux.HandleFunc("/internal/tunnels/sync", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var configs []proxy.AllowedTunnelConfig
		if err := json.NewDecoder(r.Body).Decode(&configs); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		router.SyncAllowedTunnels(configs)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"synced"}`))
	})
}

func writeMetrics(w http.ResponseWriter, router *proxy.Router) {
	sessions := router.GetActiveSessionsSnapshot()
	fmt.Fprintf(w, "# HELP edgeproxy_tunnels_active Number of active tunnel sessions\n")
	fmt.Fprintf(w, "# TYPE edgeproxy_tunnels_active gauge\n")
	fmt.Fprintf(w, "edgeproxy_tunnels_active %d\n", len(sessions))
	fmt.Fprintf(w, "# HELP edgeproxy_goroutines Number of goroutines\n")
	fmt.Fprintf(w, "# TYPE edgeproxy_goroutines gauge\n")
	fmt.Fprintf(w, "edgeproxy_goroutines %d\n", runtime.NumGoroutine())
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	fmt.Fprintf(w, "# HELP edgeproxy_heap_alloc_bytes Heap bytes in use\n")
	fmt.Fprintf(w, "# TYPE edgeproxy_heap_alloc_bytes gauge\n")
	fmt.Fprintf(w, "edgeproxy_heap_alloc_bytes %d\n", m.Alloc)
	fmt.Fprintf(w, "# HELP edgeproxy_heap_sys_bytes Heap bytes obtained from OS\n")
	fmt.Fprintf(w, "# TYPE edgeproxy_heap_sys_bytes gauge\n")
	fmt.Fprintf(w, "edgeproxy_heap_sys_bytes %d\n", m.Sys)
	for _, s := range sessions {
		sub, _ := s["subdomain"].(string)
		bi, _ := s["bytesIn"].(uint64)
		bo, _ := s["bytesOut"].(uint64)
		fmt.Fprintf(w, "edgeproxy_tunnel_bytes_in{subdomain=%q} %d\n", sub, bi)
		fmt.Fprintf(w, "edgeproxy_tunnel_bytes_out{subdomain=%q} %d\n", sub, bo)
	}
}
