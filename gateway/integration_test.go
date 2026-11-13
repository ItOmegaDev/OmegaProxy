package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"edgeproxy/gateway/protocol"
	"edgeproxy/gateway/proxy"
)

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func TestIntegration_StreamResponse(t *testing.T) {
	router := proxy.NewRouter("edgeproxy.mesh", 1000, 1000)
	// Allow the demo tunnel with a known token.
	import2 := "testtoken"
	_ = import2
	h := sha256Hex("testtoken")
	router.SyncAllowedTunnels([]proxy.AllowedTunnelConfig{
		{Subdomain: "demo", AuthTokenHash: h, IsActive: true, MaxRPS: 1000},
	})

	gwConn, agentConn := net.Pipe()
	defer gwConn.Close()
	defer agentConn.Close()

	go handleAgentConnection(router, gwConn)

	// Fake agent handshake.
	hs, _ := json.Marshal(map[string]string{"subdomain": "demo", "token": "testtoken", "version": "v1"})
	agentConn.Write((&protocol.Frame{StreamID: 0, Type: protocol.FrameSyn, Payload: hs}).Encode())
	// read ack
	protocol.ReadFrame(agentConn)

	// Wait for session registration.
	for i := 0; i < 50; i++ {
		snap := router.GetActiveSessionsSnapshot()
		if len(snap) > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	// Fake agent: read request SYN, then stream a response.
	go func() {
		f, err := protocol.ReadFrame(agentConn)
		if err != nil {
			return
		}
		resp := "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 11\r\n\r\nhello world"
		chunk1 := resp[:20]
		chunk2 := resp[20:]
		agentConn.Write((&protocol.Frame{StreamID: f.StreamID, Type: protocol.FrameData, Payload: []byte(chunk1)}).Encode())
		time.Sleep(10 * time.Millisecond)
		agentConn.Write((&protocol.Frame{StreamID: f.StreamID, Type: protocol.FrameData, Payload: []byte(chunk2)}).Encode())
		agentConn.Write((&protocol.Frame{StreamID: f.StreamID, Type: protocol.FrameFin}).Encode())
		for {
			if _, err := protocol.ReadFrame(agentConn); err != nil {
				return
			}
		}
	}()

	req := httptest.NewRequest(http.MethodGet, "http://demo.edgeproxy.mesh/", nil)
	req.Host = "demo.edgeproxy.mesh"
	rr := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		router.ServeHTTP(rr, req)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("ServeHTTP timed out")
	}

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	if got := rr.Body.String(); got != "hello world" {
		t.Fatalf("body = %q, want %q", got, "hello world")
	}
}

func TestIntegration_FrameRst(t *testing.T) {
	router := proxy.NewRouter("edgeproxy.mesh", 1000, 1000)
	router.SyncAllowedTunnels([]proxy.AllowedTunnelConfig{
		{Subdomain: "demo", AuthTokenHash: sha256Hex("testtoken"), IsActive: true, MaxRPS: 1000},
	})
	gwConn, agentConn := net.Pipe()
	defer gwConn.Close()
	defer agentConn.Close()

	go handleAgentConnection(router, gwConn)

	hs, _ := json.Marshal(map[string]string{"subdomain": "demo", "token": "testtoken", "version": "v1"})
	agentConn.Write((&protocol.Frame{StreamID: 0, Type: protocol.FrameSyn, Payload: hs}).Encode())
	protocol.ReadFrame(agentConn)

	for i := 0; i < 50; i++ {
		if len(router.GetActiveSessionsSnapshot()) > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	go func() {
		f, _ := protocol.ReadFrame(agentConn)
		agentConn.Write((&protocol.Frame{StreamID: f.StreamID, Type: protocol.FrameRst, Payload: []byte("boom")}).Encode())
		for {
			if _, err := protocol.ReadFrame(agentConn); err != nil {
				return
			}
		}
	}()

	req := httptest.NewRequest(http.MethodGet, "http://demo.edgeproxy.mesh/", nil)
	req.Host = "demo.edgeproxy.mesh"
	rr := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		router.ServeHTTP(rr, req)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("ServeHTTP timed out")
	}
	t.Logf("status=%d body=%s", rr.Code, rr.Body.String())
}