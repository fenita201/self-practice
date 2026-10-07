package main

import (
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	URI                  string
	DBCount              int
	DBPrefix             string
	CollectionsPerDB     int
	CollPrefix           string
	DocsPerCollection    int
	TargetMBPerDB        int
	IndexesPerCollection int
	BatchSize            int
	Concurrency          int
	DropExisting         bool
	Seed                 uint64
}

func str(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func intEnv(k string, d int) int {
	v := os.Getenv(k)
	if v == "" {
		return d
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s must be an integer, got %q\n", k, v)
		os.Exit(1)
	}
	return n
}

func buildURI() string {
	if u := os.Getenv("MONGO_URI"); u != "" {
		return u
	}
	target := str("TARGET", "src")
	if target == "custom" {
		fmt.Fprintln(os.Stderr, "TARGET=custom requires MONGO_URI")
		os.Exit(1)
	}
	upper, rs, basePort := "DST", str("DST_RS", "dst-rs"), 27026
	if target == "src" {
		upper, rs, basePort = "SRC", str("SRC_RS", "src-rs"), 27016
	}
	host := os.Getenv("MONGO_HOST")
	if host == "" {
		fmt.Fprintln(os.Stderr, "MONGO_HOST is required in .env (or set MONGO_URI)")
		os.Exit(1)
	}
	hosts := ""
	for i := 1; i <= 3; i++ {
		if i > 1 {
			hosts += ","
		}
		hosts += fmt.Sprintf("%s:%s", host, str(fmt.Sprintf("%s_PORT_%d", upper, i), strconv.Itoa(basePort+i)))
	}
	return fmt.Sprintf("mongodb://%s:%s@%s/?replicaSet=%s&authSource=admin",
		url.QueryEscape(str("ADMIN_USER", "admin")), url.QueryEscape(str("ADMIN_PASSWORD", "admin_pass")), hosts, rs)
}

func loadConfig() Config {
	// chay tu generator-go/ => ../.env ; fallback ./.env
	_ = godotenv.Load("../.env")
	_ = godotenv.Load(".env")
	seed := uint64(time.Now().UnixNano())
	if os.Getenv("SEED") != "" {
		seed = uint64(intEnv("SEED", 0))
	}
	return Config{
		URI:                  buildURI(),
		DBCount:              intEnv("DB_COUNT", 3),
		DBPrefix:             str("DB_PREFIX", "synctest_db"),
		CollectionsPerDB:     intEnv("COLLECTIONS_PER_DB", 5),
		CollPrefix:           str("COLL_PREFIX", "coll"),
		DocsPerCollection:    intEnv("DOCS_PER_COLLECTION", 10000),
		TargetMBPerDB:        intEnv("TARGET_MB_PER_DB", 50),
		IndexesPerCollection: intEnv("INDEXES_PER_COLLECTION", 2),
		BatchSize:            intEnv("BATCH_SIZE", 1000),
		Concurrency:          intEnv("CONCURRENCY", 4),
		DropExisting:         str("DROP_EXISTING", "true") == "true",
		Seed:                 seed,
	}
}

var uriPass = regexp.MustCompile(`//([^:/@]+):[^@]*@`)

func maskURI(u string) string { return uriPass.ReplaceAllString(u, "//$1:***@") }
