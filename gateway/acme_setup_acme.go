//go:build acme

package main

import (
	"crypto/tls"
	"net/http"
	"strings"

	"golang.org/x/crypto/acme/autocert"
)

func tryACME(enabled bool, domainsStr, email, cache string, router http.Handler) (http.Handler, *tls.Config, bool, error) {
	if !enabled {
		return router, nil, false, nil
	}
	if domainsStr == "" {
		return nil, nil, false, errMissingDomains
	}
	domains := strings.Split(domainsStr, ",")
	for i := range domains {
		domains[i] = strings.TrimSpace(domains[i])
	}
	mgr := &autocert.Manager{
		Prompt:     autocert.AcceptTOS,
		HostPolicy: autocert.HostWhitelist(domains...),
		Cache:      autocert.DirCache(cache),
		Email:      email,
	}
	return mgr.HTTPHandler(router), mgr.TLSConfig(), true, nil
}

var errMissingDomains = errStr("acme requires -acme-domains")

type errStr string

func (e errStr) Error() string { return string(e) }