package proxy

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"edgeproxy/gateway/limiter"
	"edgeproxy/gateway/protocol"
)

// AllowedTunnelConfig holds tunnel permissions synchronized from Control Plane / Database
type AllowedTunnelConfig struct {
	Subdomain     string  `json:"subdomain"`
	AuthTokenHash string  `json:"tokenHash"`
	MaxRPS        float64 `json:"maxRps"`
	IsActive      bool    `json:"isActive"`
}

// AgentTelemetry represents metrics reported by the agent's local metrics collector
type AgentTelemetry struct {
	AgentID         string    `json:"agentId"`
	Subdomain       string    `json:"subdomain"`
	Timestamp       time.Time `json:"timestamp"`
	TotalRequests   uint64    `json:"totalRequests"`
	ActiveStreams   int32     `json:"activeStreams"`
	BytesSent       uint64    `json:"bytesSent"`
	BytesReceived   uint64    `json:"bytesReceived"`
	AvgLatencyMs    float64   `json:"avgLatencyMs"`
	P50LatencyMs    float64   `json:"p50LatencyMs"`
	P95LatencyMs    float64   `json:"p95LatencyMs"`
	P99LatencyMs    float64   `json:"p99LatencyMs"`
	ErrorCount      uint64    `json:"errorCount"`
	LocalServiceRTT float64   `json:"localServiceRttMs"`
}

// TunnelSession represents an active connected agent
type TunnelSession struct {
	ID              string
	Subdomain       string
	Conn            net.Conn
	WriterLock      sync.Mutex
	Streams         map[uint32]chan []byte
	StreamsMu       sync.RWMutex
	NextStream      uint32
	CreatedAt       time.Time
	BytesIn         uint64
	BytesOut        uint64
	TelemetryMu     sync.Mutex
	LatestTelemetry *AgentTelemetry
}

// Router maintains active subdomain mappings and proxies incoming TCP/HTTP requests
type Router struct {
	mu             sync.RWMutex
	sessions       map[string]*TunnelSession      // key: subdomain
	allowedTunnels map[string]AllowedTunnelConfig // synchronized from Control Plane / DB
	rateLimiter    *limiter.RateLimiterStore
	tunnelLimiters map[string]*limiter.TokenBucket
	globalRPS      float64
	baseDomain     string
}

func NewRouter(baseDomain string, rps, burst float64) *Router {
	return &Router{
		sessions:       make(map[string]*TunnelSession),
		allowedTunnels: make(map[string]AllowedTunnelConfig),
		rateLimiter:    limiter.NewRateLimiterStore(rps, burst),
		tunnelLimiters: make(map[string]*limiter.TokenBucket),
		globalRPS:      rps,
		baseDomain:     baseDomain,
	}
}

// SyncAllowedTunnels loads or updates allowed tunnels from DB / Control Plane.
// Invalid entries are ignored instead of widening access.
func (r *Router) SyncAllowedTunnels(configs []AllowedTunnelConfig) {
	r.mu.Lock()
	defer r.mu.Unlock()

	newMap := make(map[string]AllowedTunnelConfig)
	newLimiters := make(map[string]*limiter.TokenBucket)
	skipped := 0
	for _, cfg := range configs {
		if !ValidSubdomain(cfg.Subdomain) || !validTokenHash(cfg.AuthTokenHash) {
			skipped++
			continue
		}
		newMap[cfg.Subdomain] = cfg
		rps := cfg.MaxRPS
		if rps <= 0 {
			rps = r.globalRPS
		}
		newLimiters[cfg.Subdomain] = limiter.NewTokenBucket(rps*1.5, rps)
	}
	r.allowedTunnels = newMap
	r.tunnelLimiters = newLimiters
	log.Printf("[ROUTER-SYNC] Synchronized %d authorized tunnels (skipped %d invalid)", len(newMap), skipped)
}

// ValidSubdomain reports whether value is a single, safe DNS label.
func ValidSubdomain(value string) bool {
	if len(value) < 1 || len(value) > 63 {
		return false
	}
	if value[0] == '-' || value[len(value)-1] == '-' {
		return false
	}
	for i := 0; i < len(value); i++ {
		c := value[i]
		if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '-' {
			return false
		}
	}
	return true
}

func validTokenHash(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

// VerifyAuthorization checks the agent token against the stored SHA-256 hash.
// Deny by default: no configured tunnels, inactive tunnels, empty hashes and
// empty tokens are all rejected.
func (r *Router) VerifyAuthorization(subdomain, token string) bool {
	if !ValidSubdomain(subdomain) || token == "" || len(token) > 512 {
		return false
	}

	r.mu.RLock()
	cfg, exists := r.allowedTunnels[subdomain]
	r.mu.RUnlock()

	if !exists || !cfg.IsActive || !validTokenHash(cfg.AuthTokenHash) {
		return false
	}

	sum := sha256.Sum256([]byte(token))
	presented := hex.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(presented), []byte(strings.ToLower(cfg.AuthTokenHash))) == 1
}

// RegisterSession attaches a new authenticated local agent tunnel
func (r *Router) RegisterSession(subdomain string, conn net.Conn) *TunnelSession {
	r.mu.Lock()
	defer r.mu.Unlock()

	// If a previous session exists for this subdomain, close it before replacing.
	if previous, exists := r.sessions[subdomain]; exists && previous != nil {
		_ = previous.Conn.Close()
	}

	session := &TunnelSession{
		ID:        fmt.Sprintf("sess_%d", time.Now().UnixNano()),
		Subdomain: subdomain,
		Conn:      conn,
		Streams:   make(map[uint32]chan []byte),
		CreatedAt: time.Now(),
	}

	r.sessions[subdomain] = session
	log.Printf("[ROUTER] Registered authenticated tunnel session for %s.%s (ID: %s)", subdomain, r.baseDomain, session.ID)
	return session
}

// UnregisterSession removes a disconnected agent, but only if the session
// being unregistered is still the active one for the subdomain. This prevents
// a stale handler from deleting a newer session that replaced it.
func (r *Router) UnregisterSession(subdomain string, session *TunnelSession) {
	r.mu.Lock()
	defer r.mu.Unlock()

	current, exists := r.sessions[subdomain]
	if !exists || current == nil {
		return
	}
	if session != nil && current != session {
		log.Printf("[ROUTER] Ignoring unregister for stale session %s on %s", session.ID, subdomain)
		return
	}
	current.Conn.Close()
	delete(r.sessions, subdomain)
	log.Printf("[ROUTER] Unregistered tunnel session for %s", subdomain)
}

// RecordTelemetry stores real agent metrics received via FrameMetrics
func (r *Router) RecordTelemetry(subdomain string, data []byte) {
	var telem AgentTelemetry
	if err := json.Unmarshal(data, &telem); err != nil {
		log.Printf("[ROUTER-METRICS] Error decoding telemetry from %s: %v", subdomain, err)
		return
	}

	r.mu.RLock()
	sess, exists := r.sessions[subdomain]
	r.mu.RUnlock()

	if exists && sess != nil {
		sess.TelemetryMu.Lock()
		sess.LatestTelemetry = &telem
		sess.TelemetryMu.Unlock()
		atomic.StoreUint64(&sess.BytesIn, telem.BytesReceived)
		atomic.StoreUint64(&sess.BytesOut, telem.BytesSent)
		log.Printf("[AGENT-TELEMETRY] Subdomain %s: %d reqs, avg lat %.2f ms, active streams: %d",
			subdomain, telem.TotalRequests, telem.AvgLatencyMs, telem.ActiveStreams)
	}
}

// GetActiveSessionsSnapshot returns real telemetry for Control Plane synchronization
func (r *Router) GetActiveSessionsSnapshot() []map[string]interface{} {
	r.mu.RLock()
	defer r.mu.RUnlock()

	out := make([]map[string]interface{}, 0, len(r.sessions))
	for sub, sess := range r.sessions {
		entry := map[string]interface{}{
			"subdomain": sub,
			"sessionId": sess.ID,
			"createdAt": sess.CreatedAt,
			"bytesIn":   atomic.LoadUint64(&sess.BytesIn),
			"bytesOut":  atomic.LoadUint64(&sess.BytesOut),
		}
		sess.TelemetryMu.Lock()
		telem := sess.LatestTelemetry
		sess.TelemetryMu.Unlock()
		if telem != nil {
			entry["telemetry"] = telem
		}
		out = append(out, entry)
	}
	return out
}

// ServeHTTP inspects Host header and proxies request through the binary tunnel
func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	// Liveness endpoint used by container orchestration. It exposes no state.
	if req.URL.Path == "/healthz" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{"status":"ok"}`)
		return
	}

	clientIP, _, _ := net.SplitHostPort(req.RemoteAddr)
	if !r.rateLimiter.Check(clientIP) {
		http.Error(w, "HTTP 429: Rate Limit Exceeded", http.StatusTooManyRequests)
		return
	}

	host := strings.ToLower(req.Host)
	if hostOnly, _, err := net.SplitHostPort(host); err == nil {
		host = hostOnly
	}
	baseDomain := strings.ToLower(r.baseDomain)

	subdomain := ""
	if host == baseDomain {
		subdomain = ""
	} else if strings.HasSuffix(host, "."+baseDomain) {
		subdomain = strings.TrimSuffix(host, "."+baseDomain)
	} else {
		http.Error(w, "HTTP 404: Unknown host", http.StatusNotFound)
		return
	}

	if subdomain == "" {
		// Root domain hit
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		r.mu.RLock()
		activeCount := len(r.sessions)
		r.mu.RUnlock()
		fmt.Fprintf(w, `{"service":"OmegaProxy Gateway","status":"online","tunnels_active":%d,"base_domain":"%s"}`, activeCount, baseDomain)
		return
	}

	if !ValidSubdomain(subdomain) {
		http.Error(w, "HTTP 400: Invalid subdomain", http.StatusBadRequest)
		return
	}

	r.mu.RLock()
	session, exists := r.sessions[subdomain]
	r.mu.RUnlock()

	if !exists {
		http.Error(w, fmt.Sprintf("HTTP 502: Tunnel '%s.%s' is currently offline or unreachable", subdomain, baseDomain), http.StatusBadGateway)
		return
	}

	// Per-tunnel rate limit (in addition to the global per-IP limit).
	r.mu.RLock()
	tl, hasTL := r.tunnelLimiters[subdomain]
	r.mu.RUnlock()
	if hasTL && tl != nil && !tl.Allow() {
		http.Error(w, "HTTP 429: Tunnel rate limit exceeded", http.StatusTooManyRequests)
		return
	}

	// Allocate stream ID with buffered channel and explicit credit-based flow control
	streamID := atomic.AddUint32(&session.NextStream, 1)
	respChan := make(chan []byte, 128)

	session.StreamsMu.Lock()
	session.Streams[streamID] = respChan
	session.StreamsMu.Unlock()

	defer func() {
		session.StreamsMu.Lock()
		delete(session.Streams, streamID)
		session.StreamsMu.Unlock()
	}()

	// Read the full request body (capped) so we can forward it with a
	// correct Content-Length and stream it in chunks below.
	var bodyBytes []byte
	if req.Body != nil {
		req.Body = http.MaxBytesReader(w, req.Body, 64<<20)
		b, err := io.ReadAll(req.Body)
		if err != nil {
			http.Error(w, "HTTP 400: Failed reading request body", http.StatusBadRequest)
			return
		}
		bodyBytes = b
		req.Body = io.NopCloser(bytes.NewReader(bodyBytes))
		req.ContentLength = int64(len(bodyBytes))
		req.TransferEncoding = nil
	}

	// Serialize request headers (without body) for the SYN frame.
	req.Body = nil
	var headerBuf bytes.Buffer
	if err := req.Write(&headerBuf); err != nil {
		http.Error(w, "HTTP 500: Failed serializing HTTP request", http.StatusInternalServerError)
		return
	}

	synFrame := &protocol.Frame{
		StreamID: streamID,
		Type:     protocol.FrameSyn,
		Payload:  headerBuf.Bytes(),
	}

	session.WriterLock.Lock()
	_, err := session.Conn.Write(synFrame.Encode())
	session.WriterLock.Unlock()

	if err != nil {
		http.Error(w, "HTTP 504: Failed writing frame to tunnel wire", http.StatusGatewayTimeout)
		return
	}

	// Stream request body (if any) as DATA frames followed by FIN.
	if len(bodyBytes) > 0 {
		reader := bytes.NewReader(bodyBytes)
		buf := make([]byte, 32768)
		for {
			n, rerr := reader.Read(buf)
			if n > 0 {
				session.WriterLock.Lock()
				_, werr := session.Conn.Write((&protocol.Frame{
					StreamID: streamID,
					Type:     protocol.FrameData,
					Payload:  append([]byte(nil), buf[:n]...),
				}).Encode())
				session.WriterLock.Unlock()
				if werr != nil {
					http.Error(w, "HTTP 504: Failed writing request body", http.StatusGatewayTimeout)
					return
				}
			}
			if rerr == io.EOF {
				break
			}
			if rerr != nil {
				http.Error(w, "HTTP 400: Failed reading request body", http.StatusBadRequest)
				return
			}
		}
	}
	// Signal end of request.
	session.WriterLock.Lock()
	session.Conn.Write((&protocol.Frame{
		StreamID: streamID,
		Type:     protocol.FrameFin,
	}).Encode())
	session.WriterLock.Unlock()

	// Wait for first response chunk from agent
	select {
	case payload, ok := <-respChan:
		if !ok {
			http.Error(w, "HTTP 502: Bad Gateway (Empty response from agent)", http.StatusBadGateway)
			return
		}
		if len(payload) == 0 {
			// Wait for next chunk
			select {
			case p2, ok2 := <-respChan:
				if !ok2 || len(p2) == 0 {
					http.Error(w, "HTTP 502: Bad Gateway (Empty response from agent)", http.StatusBadGateway)
					return
				}
				payload = p2
			case <-time.After(15 * time.Second):
				http.Error(w, "HTTP 504: Gateway Timeout (Local Agent did not respond)", http.StatusGatewayTimeout)
				return
			}
		}

		// Send FrameAck
		session.WriterLock.Lock()
		session.Conn.Write((&protocol.Frame{
			StreamID: streamID,
			Type:     protocol.FrameAck,
		}).Encode())
		session.WriterLock.Unlock()

		// Stream all response bytes through a pipe so http.ReadResponse can
		// parse headers correctly regardless of frame boundaries.
		pr, pw := io.Pipe()
		go func(first []byte) {
			if len(first) > 0 {
				pw.Write(first)
			}
			for chunk := range respChan {
				if len(chunk) > 0 {
					pw.Write(chunk)
				}
				session.WriterLock.Lock()
				session.Conn.Write((&protocol.Frame{
					StreamID: streamID,
					Type:     protocol.FrameAck,
				}).Encode())
				session.WriterLock.Unlock()
			}
			pw.Close()
		}(payload)

		resp, pErr := http.ReadResponse(bufio.NewReader(pr), req)
		if pErr != nil {
			pr.Close()
			http.Error(w, "HTTP 502: Bad Gateway", http.StatusBadGateway)
			return
		}
		for k, vv := range resp.Header {
			for _, v := range vv {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
		resp.Body.Close()
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}

	case <-time.After(15 * time.Second):
		http.Error(w, "HTTP 504: Gateway Timeout (Local Agent did not respond)", http.StatusGatewayTimeout)
	}
}
