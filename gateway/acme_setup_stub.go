//go:build !acme

package main

import (
	"crypto/tls"
	"errors"
	"net/http"
)

func tryACME(enabled bool, domainsStr, email, cache string, router http.Handler) (http.Handler, *tls.Config, bool, error) {
	if !enabled {
		return router, nil, false, nil
	}
	return nil, nil, false, errors.New("ACME support not compiled in; rebuild with -tags acme (requires golang.org/x/crypto)")
}