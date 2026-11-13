package protocol

import (
	"bytes"
	"testing"
)

func FuzzReadFrame(f *testing.F) {
	// Seed corpus with valid and boundary frames.
	f.Add([]byte{0, 0, 0, 1, 0x01, 0, 0, 0, 0})
	f.Add([]byte{0, 0, 0, 1, 0x01, 0, 0, 0, 5, 'h', 'e', 'l', 'l', 'o'})
	f.Add(make([]byte, HeaderSize+100))
	f.Fuzz(func(t *testing.T, data []byte) {
		fr, err := ReadFrame(bytes.NewReader(data))
		if err != nil {
			return
		}
		if fr == nil {
			t.Fatal("nil frame without error")
		}
		if fr.Length != uint32(len(fr.Payload)) {
			t.Fatalf("length mismatch: %d vs %d", fr.Length, len(fr.Payload))
		}
		// Round-trip encode must not panic.
		_ = fr.Encode()
	})
}

func BenchmarkReadFrame(b *testing.B) {
	data := make([]byte, HeaderSize+1024)
	data[4] = FrameData
	// length
	data[5] = 0
	data[6] = 0
	data[7] = 4
	data[8] = 0
	b.SetBytes(int64(len(data)))
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _ = ReadFrame(bytes.NewReader(data))
	}
}

func BenchmarkEncodeFrame(b *testing.B) {
	f := &Frame{StreamID: 42, Type: FrameData, Payload: make([]byte, 1024)}
	b.SetBytes(int64(HeaderSize + len(f.Payload)))
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = f.Encode()
	}
}
