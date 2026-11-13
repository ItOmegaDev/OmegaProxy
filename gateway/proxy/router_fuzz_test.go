package proxy

import (
	"testing"
)

func FuzzValidSubdomain(f *testing.F) {
	f.Add("demo")
	f.Add("a")
	f.Add("")
	f.Add("my-api")
	f.Fuzz(func(t *testing.T, s string) {
		_ = ValidSubdomain(s)
	})
}

func BenchmarkValidSubdomain(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		ValidSubdomain("my-service-42")
	}
}

func BenchmarkVerifyAuthorization(b *testing.B) {
	r := NewRouter("edgeproxy.mesh", 100, 150)
	r.SyncAllowedTunnels([]AllowedTunnelConfig{
		{Subdomain: "demo", AuthTokenHash: "0000000000000000000000000000000000000000000000000000000000000000", IsActive: true},
	})
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		r.VerifyAuthorization("demo", "token")
	}
}
