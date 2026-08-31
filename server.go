package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
)

func main() {
	port := 8000
	if len(os.Args) > 2 {
		log.Fatal("usage: go run server.go [port]")
	}
	if len(os.Args) > 1 {
		n, err := strconv.Atoi(os.Args[1])
		if err != nil || n < 1 || n > 65535 {
			log.Fatalf("invalid port %q", os.Args[1])
		}
		port = n
	}
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	fmt.Printf("Serving . at http://%s/\n", addr)
	log.Fatal(http.ListenAndServe(addr, http.FileServer(http.Dir("."))))
}
