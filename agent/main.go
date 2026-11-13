package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"edgeproxy/agent/client"
	"edgeproxy/agent/demux"
)

func main() {
	gatewayAddr := flag.String("gateway", "gateway.edgeproxy.mesh:4242", "Edge Gateway TCP control plane address")
	subdomain := flag.String("subdomain", "", "Requested custom subdomain (e.g. 'myapi')")
	port := flag.Int("port", 3000, "Target local port to expose (e.g. 3000, 8080)")
	token := flag.String("token", "", "EdgeProxy auth token (strictly required; or EDGEPROXY_TOKEN env / EDGEPROXY_TOKEN_FILE)")
	tokenFile := flag.String("token-file", "", "Path to file containing the agent token")
	domain := flag.String("domain", "edgeproxy.mesh", "Base domain shown in the public URL")
	autoDiscover := flag.Bool("auto", true, "Auto-discover active listening ports if port is closed")
	tunnelTLS := flag.Bool("tunnel-tls", false, "Use TLS for the tunnel connection to the gateway")
	tunnelCA := flag.String("tunnel-ca", "", "CA bundle to verify the gateway tunnel certificate")
	tunnelServerName := flag.String("tunnel-server-name", "", "Override TLS server name for the tunnel connection")
	insecureSkipVerify := flag.Bool("insecure-skip-verify", false, "Skip TLS verification (NOT recommended)")
	flag.Parse()

	// Resolve token from flag, env, or file (avoid leaking via process args).
	authToken := *token
	if authToken == "" {
		authToken = strings.TrimSpace(os.Getenv("EDGEPROXY_TOKEN"))
	}
	if authToken == "" && *tokenFile != "" {
		data, err := os.ReadFile(*tokenFile)
		if err != nil {
			log.Fatalf("[FATAL] Cannot read token file: %v", err)
		}
		authToken = strings.TrimSpace(string(data))
	}
	if authToken == "" && os.Getenv("EDGEPROXY_TOKEN_FILE") != "" {
		data, err := os.ReadFile(os.Getenv("EDGEPROXY_TOKEN_FILE"))
		if err != nil {
			log.Fatalf("[FATAL] Cannot read token file: %v", err)
		}
		authToken = strings.TrimSpace(string(data))
	}

	// Strict token enforcement
	if authToken == "" {
		log.Fatal("[FATAL] Missing required auth token. Pass -token, EDGEPROXY_TOKEN, or -token-file.")
	}

	if *subdomain == "" {
		*subdomain = fmt.Sprintf("dev-%d", time.Now().Unix()%10000)
	}

	fmt.Println("================================================================")
	fmt.Println("  EdgeProxy Local Agent (CLI v1.0.0-PROD) - Zero-Config Tunnel  ")
	fmt.Println("  Made by ItOmegaDev")
	fmt.Println("================================================================")
	fmt.Printf("  Target Port     : http://127.0.0.1:%d\n", *port)
	fmt.Printf("  Assigned Domain : https://%s.%s\n", *subdomain, *domain)
	fmt.Printf("  Gateway Remote  : %s\n", *gatewayAddr)
	fmt.Println("----------------------------------------------------------------")

	// Verify if local port is active
	if !demux.CheckLocalPort(*port) {
		fmt.Printf("⚠️  Warning: Port %d is not actively listening.\n", *port)
		if *autoDiscover {
			for _, testPort := range []int{3000, 5173, 8080, 8000, 4200} {
				if demux.CheckLocalPort(testPort) {
					fmt.Printf("🔍 Auto-discovered active local service on port :%d! Switching target.\n", testPort)
					*port = testPort
					break
				}
			}
		}
	} else {
		fmt.Printf("✅ Local service verified on port :%d\n", *port)
	}

	agent := client.NewTunnelClient(*gatewayAddr, *subdomain, *domain, *port, authToken)
	agent.ConfigureTLS(*tunnelTLS, *tunnelServerName, *tunnelCA, *insecureSkipVerify)
	if *insecureSkipVerify {
		log.Println("[WARN] TLS verification disabled for tunnel connection; not recommended for production")
	}

	// Graceful termination handling
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-sigChan
		fmt.Println("\n[AGENT] Terminating tunnel session...")
		agent.Stop()
		os.Exit(0)
	}()

	backoff := time.Second
	for {
		err := agent.Start()
		if err == nil {
			// Clean stop requested.
			return
		}
		if !agent.IsRunning() {
			log.Fatalf("[FATAL] Agent stopped: %v", err)
		}
		log.Printf("[AGENT] Disconnected: %v; reconnecting in %s", err, backoff)
		time.Sleep(backoff)
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}
