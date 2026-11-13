package client

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"sync"
	"time"

	"edgeproxy/agent/demux"
	"edgeproxy/agent/metrics"
)

// Header size: 9 bytes
const HeaderSize = 9

const (
	FrameSyn     byte = 0x01
	FrameData    byte = 0x02
	FrameFin     byte = 0x03
	FramePing    byte = 0x04
	FramePong    byte = 0x05
	FrameRst     byte = 0x06
	FrameAck     byte = 0x07
	FrameMetrics byte = 0x08
)

// MaxInFlightWindow defines max unacknowledged 32KB chunks per stream for backpressure
const MaxInFlightWindow = 4

type TunnelClient struct {
	gatewayAddr string
	subdomain   string
	localPort   int
	token       string
	domain      string
	demuxer     *demux.StreamDemuxer
	collector   *metrics.LocalMetricsCollector
	conn        net.Conn
	mu          sync.Mutex
	running     bool

	connMu   sync.Mutex
	connDone chan struct{}

	// TLS settings for the tunnel wire (opt-in).
	useTLS             bool
	tlsServerName      string
	tlsCAFile          string
	insecureSkipVerify bool

	// Flow control credit map: streamID -> channel of ACK pulses
	ackChans   map[uint32]chan struct{}
	ackChansMu sync.RWMutex

	// Per-stream request body pipes for streaming uploads.
	streamPipes   map[uint32]*io.PipeWriter
	streamPipesMu sync.Mutex
}

func NewTunnelClient(gatewayAddr, subdomain, domain string, localPort int, token string) *TunnelClient {
	agentID := fmt.Sprintf("agent-%s-%d", subdomain, time.Now().Unix())
	return &TunnelClient{
		gatewayAddr: gatewayAddr,
		subdomain:   subdomain,
		localPort:   localPort,
		token:       token,
		domain:      domain,
		demuxer:     demux.NewStreamDemuxer(fmt.Sprintf("127.0.0.1:%d", localPort)),
		collector:     metrics.NewMetricsCollector(agentID, subdomain),
		ackChans:      make(map[uint32]chan struct{}),
		streamPipes:   make(map[uint32]*io.PipeWriter),
	}
}

// ConfigureTLS enables TLS on the tunnel wire. Must be called before Start.
func (c *TunnelClient) ConfigureTLS(useTLS bool, serverName, caFile string, insecure bool) {
	c.useTLS = useTLS
	c.tlsServerName = serverName
	c.tlsCAFile = caFile
	c.insecureSkipVerify = insecure
}

// buildTLSConfig constructs the client TLS configuration for the tunnel.
func (c *TunnelClient) buildTLSConfig() (*tls.Config, error) {
	cfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if c.tlsServerName != "" {
		cfg.ServerName = c.tlsServerName
	} else if host, _, err := net.SplitHostPort(c.gatewayAddr); err == nil {
		cfg.ServerName = host
	}
	if c.tlsCAFile != "" {
		pemBytes, err := os.ReadFile(c.tlsCAFile)
		if err != nil {
			return nil, fmt.Errorf("read CA bundle: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pemBytes) {
			return nil, fmt.Errorf("failed to parse CA bundle")
		}
		cfg.RootCAs = pool
	}
	cfg.InsecureSkipVerify = c.insecureSkipVerify
	return cfg, nil
}

// Start opens a (optionally TLS) multiplexed connection to the Gateway and listens for virtual streams
func (c *TunnelClient) Start() error {
	c.mu.Lock()
	c.running = true
	c.mu.Unlock()

	log.Printf("[AGENT] Connecting to Edge Gateway at %s (tls=%t)...", c.gatewayAddr, c.useTLS)

	var conn net.Conn
	var err error
	if c.useTLS {
		tlsCfg, err := c.buildTLSConfig()
		if err != nil {
			return fmt.Errorf("tunnel TLS config: %w", err)
		}
		dialer := &net.Dialer{Timeout: 5 * time.Second}
		conn, err = tls.DialWithDialer(dialer, "tcp", c.gatewayAddr, tlsCfg)
	} else {
		conn, err = net.DialTimeout("tcp", c.gatewayAddr, 5*time.Second)
	}
	if err != nil {
		return fmt.Errorf("failed connecting to gateway: %w", err)
	}
	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()
	if !c.IsRunning() {
		conn.Close()
		return fmt.Errorf("stopped")
	}

	// Handshake: send SYN frame with JSON handshake payload containing subdomain + auth token
	handshakePayload, err := json.Marshal(map[string]string{
		"subdomain": c.subdomain,
		"token":     c.token,
		"version":   "v1.0.0",
	})
	if err != nil {
		return fmt.Errorf("failed encoding handshake: %w", err)
	}
	handshakeFrame := encodeFrame(0, FrameSyn, handshakePayload)
	if _, err := c.conn.Write(handshakeFrame); err != nil {
		return fmt.Errorf("handshake write failed: %w", err)
	}

	// Wait for the gateway's handshake acknowledgement. A rejected token comes
	// back as FrameRst with an explanatory payload.
	_ = c.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, replyType, replyPayload, err := readFrame(c.conn)
	if err != nil {
		c.conn.Close()
		return fmt.Errorf("handshake acknowledgement failed: %w", err)
	}
	_ = c.conn.SetReadDeadline(time.Time{})

	if replyType == FrameRst {
		c.conn.Close()
		return fmt.Errorf("gateway rejected tunnel: %s", string(replyPayload))
	}
	if replyType != FrameAck {
		c.conn.Close()
		return fmt.Errorf("unexpected handshake reply type 0x%02x", replyType)
	}

	log.Printf("[AGENT] Tunnel online! Public URL: https://%s.%s -> http://127.0.0.1:%d", c.subdomain, c.domain, c.localPort)

	// Per-connection cancellation for background goroutines.
	c.connMu.Lock()
	c.connDone = make(chan struct{})
	done := c.connDone
	c.connMu.Unlock()
	defer func() {
		c.connMu.Lock()
		if c.connDone != nil {
			close(c.connDone)
			c.connDone = nil
		}
		c.connMu.Unlock()
	}()

	// Keep-alive heartbeat loop
	go c.heartbeatLoop(done)

	// Periodic telemetry collector loop sending FrameMetrics
	go c.telemetryLoop(done)

	// Frame read and processing loop
	for c.running {
		streamID, frameType, payload, err := readFrame(c.conn)
		if err != nil {
			if c.running {
				log.Printf("[AGENT] Connection lost: %v", err)
			}
			if c.running {
				return fmt.Errorf("connection lost: %w", err)
			}
			return nil
		}

		switch frameType {
		case FramePing:
			c.mu.Lock()
			c.conn.Write(encodeFrame(streamID, FramePong, nil))
			c.mu.Unlock()

		case FrameAck:
			// Release backpressure credit for the corresponding stream
			c.ackChansMu.RLock()
			ch, exists := c.ackChans[streamID]
			c.ackChansMu.RUnlock()
			if exists && ch != nil {
				select {
				case ch <- struct{}{}:
				default:
				}
			}

		case FrameSyn:
			// Open a new stream: payload carries request headers (and maybe body).
			pr, pw := io.Pipe()
			c.streamPipesMu.Lock()
			c.streamPipes[streamID] = pw
			c.streamPipesMu.Unlock()
			if len(payload) > 0 {
				if _, err := pw.Write(payload); err != nil {
					log.Printf("[AGENT] Failed writing request headers for stream %d: %v", streamID, err)
				}
			}
			c.collector.StreamStarted()
			go c.handleStream(streamID, pr, pw)

		case FrameData:
			// Body chunk for an existing stream.
			c.streamPipesMu.Lock()
			pw, ok := c.streamPipes[streamID]
			c.streamPipesMu.Unlock()
			if ok && pw != nil {
				if _, err := pw.Write(payload); err != nil {
					log.Printf("[AGENT] Failed writing body for stream %d: %v", streamID, err)
				}
			}

		case FrameFin:
			c.streamPipesMu.Lock()
			pw, ok := c.streamPipes[streamID]
			delete(c.streamPipes, streamID)
			c.streamPipesMu.Unlock()
			if ok && pw != nil {
				_ = pw.Close()
			}

		case FrameRst:
			c.streamPipesMu.Lock()
			pw, ok := c.streamPipes[streamID]
			delete(c.streamPipes, streamID)
			c.streamPipesMu.Unlock()
			if ok && pw != nil {
				_ = pw.CloseWithError(fmt.Errorf("stream reset"))
			}
		}
	}

	return nil
}

func (c *TunnelClient) telemetryLoop(done <-chan struct{}) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-done:
			return
		case <-ticker.C:
		}
		if !c.IsRunning() {
			return
		}
		reportBytes, err := c.collector.EncodeJSON()
		if err == nil && len(reportBytes) > 0 {
			c.mu.Lock()
			if c.conn != nil {
				c.conn.Write(encodeFrame(0, FrameMetrics, reportBytes))
			}
			c.mu.Unlock()
		}
	}
}

func (c *TunnelClient) heartbeatLoop(done <-chan struct{}) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-done:
			return
		case <-ticker.C:
		}
		if !c.IsRunning() {
			return
		}
		c.mu.Lock()
		if c.conn != nil {
			c.conn.Write(encodeFrame(0, FramePing, nil))
		}
		c.mu.Unlock()
	}
}

func (c *TunnelClient) handleStream(sid uint32, pr *io.PipeReader, pw *io.PipeWriter) {
	defer c.collector.StreamFinished()
	defer pr.Close()

	startTime := time.Now()
	respBytes, err := c.demuxer.ForwardRequestFromReader(pr)
	duration := time.Since(startTime)

	if err != nil {
		c.collector.RecordRequest(duration, 0, 0, 502)
		c.mu.Lock()
		c.conn.Write(encodeFrame(sid, FrameRst, []byte(err.Error())))
		c.mu.Unlock()
		return
	}

	c.collector.RecordRequest(duration, 0, int64(len(respBytes)), 200)

	// Register ACK credit channel for flow control
	ackChan := make(chan struct{}, MaxInFlightWindow)
	for i := 0; i < MaxInFlightWindow; i++ {
		ackChan <- struct{}{}
	}

	c.ackChansMu.Lock()
	c.ackChans[sid] = ackChan
	c.ackChansMu.Unlock()

	defer func() {
		c.ackChansMu.Lock()
		delete(c.ackChans, sid)
		c.ackChansMu.Unlock()
	}()

	const chunkSize = 32768
	for offset := 0; offset < len(respBytes); offset += chunkSize {
		end := offset + chunkSize
		if end > len(respBytes) {
			end = len(respBytes)
		}

		select {
		case <-ackChan:
		case <-time.After(10 * time.Second):
			log.Printf("[AGENT-BACKPRESSURE] Flow control window timeout for stream %d", sid)
			return
		}

		c.mu.Lock()
		c.conn.Write(encodeFrame(sid, FrameData, respBytes[offset:end]))
		c.mu.Unlock()
	}

	c.mu.Lock()
	c.conn.Write(encodeFrame(sid, FrameFin, nil))
	c.mu.Unlock()
}

func (c *TunnelClient) IsRunning() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.running
}

func validFrameType(t byte) bool {
	switch t {
	case FrameSyn, FrameData, FrameFin, FramePing, FramePong, FrameRst, FrameAck, FrameMetrics:
		return true
	}
	return false
}

func (c *TunnelClient) Stop() {
	c.mu.Lock()
	c.running = false
	c.mu.Unlock()
	if c.conn != nil {
		c.conn.Close()
	}
}

func encodeFrame(streamID uint32, frameType byte, payload []byte) []byte {
	buf := make([]byte, HeaderSize+len(payload))
	binary.BigEndian.PutUint32(buf[0:4], streamID)
	buf[4] = frameType
	binary.BigEndian.PutUint32(buf[5:9], uint32(len(payload)))
	copy(buf[9:], payload)
	return buf
}

func readFrame(r io.Reader) (uint32, byte, []byte, error) {
	header := make([]byte, HeaderSize)
	if _, err := io.ReadFull(r, header); err != nil {
		return 0, 0, nil, err
	}

	streamID := binary.BigEndian.Uint32(header[0:4])
	frameType := header[4]
	length := binary.BigEndian.Uint32(header[5:9])

	// Mirror the gateway limit: reject oversized frames before allocating.
	if length > 65536 {
		return 0, 0, nil, fmt.Errorf("frame payload %d exceeds 64KB limit", length)
	}
	if !validFrameType(frameType) {
		return 0, 0, nil, fmt.Errorf("invalid frame type 0x%02x", frameType)
	}

	payload := make([]byte, length)
	if length > 0 {
		if _, err := io.ReadFull(r, payload); err != nil {
			return 0, 0, nil, err
		}
	}

	return streamID, frameType, payload, nil
}
