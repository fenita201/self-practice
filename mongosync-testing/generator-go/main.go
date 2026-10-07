package main

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const (
	mb         = 1024 * 1024
	maxDocSize = 16*mb - 1024
)

var indexSpecs = []bson.D{
	{{Key: "idx", Value: 1}},
	{{Key: "status", Value: 1}, {Key: "createdAt", Value: -1}},
	{{Key: "email", Value: 1}},
}

func dbName(cfg Config, i int) string   { return fmt.Sprintf("%s_%03d", cfg.DBPrefix, i) }
func collName(cfg Config, i int) string { return fmt.Sprintf("%s_%03d", cfg.CollPrefix, i) }

func main() {
	cmd := "run"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	if cmd != "run" && cmd != "stats" && cmd != "clean" {
		fmt.Fprintf(os.Stderr, "Unknown command %q. Use: run | stats | clean\n", cmd)
		os.Exit(1)
	}
	cfg := loadConfig()
	ctx := context.Background()
	client, err := mongo.Connect(options.Client().ApplyURI(cfg.URI))
	if err != nil {
		fatal(err)
	}
	defer client.Disconnect(ctx)

	switch cmd {
	case "run":
		err = generate(ctx, client, cfg)
	case "stats":
		err = stats(ctx, client, cfg)
	case "clean":
		err = clean(ctx, client, cfg)
	}
	if err != nil {
		fatal(err)
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "ERROR:", err)
	os.Exit(1)
}

func generate(ctx context.Context, client *mongo.Client, cfg Config) error {
	docsPerDB := cfg.CollectionsPerDB * cfg.DocsPerCollection
	base := sampleBaseDocBytes(cfg.Seed)
	targetBytes := float64(cfg.TargetMBPerDB * mb)
	padBytes := 0
	if targetBytes > 0 {
		padBytes = max(0, int(targetBytes/float64(docsPerDB)-base))
	}

	fmt.Printf("URI: %s\n", maskURI(cfg.URI))
	fmt.Printf("Plan: %d DB x %d coll x %d docs (seed=%d)\n", cfg.DBCount, cfg.CollectionsPerDB, cfg.DocsPerCollection, cfg.Seed)
	fmt.Printf("Doc size: base ~%.0f B + payload %d B => ~%.0f B/doc\n", base, padBytes, base+float64(padBytes))
	if targetBytes > 0 && padBytes == 0 {
		fmt.Printf("WARN: TARGET_MB_PER_DB=%d qua nho; toi thieu ~%.2f MB/DB (so doc duoc uu tien)\n", cfg.TargetMBPerDB, base*float64(docsPerDB)/mb)
	}
	if base+float64(padBytes) > maxDocSize {
		return fmt.Errorf("doc size vuot 16MB; giam TARGET_MB_PER_DB hoac tang so doc")
	}

	type task struct{ d, c int }
	var tasks []task
	for d := 1; d <= cfg.DBCount; d++ {
		for c := 1; c <= cfg.CollectionsPerDB; c++ {
			tasks = append(tasks, task{d, c})
		}
	}

	t0 := time.Now()
	sem := make(chan struct{}, max(1, cfg.Concurrency))
	var wg sync.WaitGroup
	var mu sync.Mutex
	var firstErr error
	for _, t := range tasks {
		wg.Add(1)
		sem <- struct{}{}
		go func(t task) {
			defer wg.Done()
			defer func() { <-sem }()
			if err := fillCollection(ctx, client, cfg, t.d, t.c, padBytes); err != nil {
				mu.Lock()
				if firstErr == nil {
					firstErr = fmt.Errorf("%s.%s: %w", dbName(cfg, t.d), collName(cfg, t.c), err)
				}
				mu.Unlock()
			}
		}(t)
	}
	wg.Wait()
	if firstErr != nil {
		return firstErr
	}
	fmt.Printf("Inserted in %.1fs\n", time.Since(t0).Seconds())
	if err := stats(ctx, client, cfg); err != nil {
		return err
	}
	if targetBytes > 0 {
		fmt.Printf("Target: %d MB dataSize / DB\n", cfg.TargetMBPerDB)
	}
	return nil
}

func fillCollection(ctx context.Context, client *mongo.Client, cfg Config, d, c, padBytes int) error {
	col := client.Database(dbName(cfg, d)).Collection(collName(cfg, c))
	if cfg.DropExisting {
		_ = col.Drop(ctx)
	}
	f := NewDocFactory(newRng(cfg.Seed+uint64(d*100000+c)), padBytes)
	for i := 0; i < cfg.DocsPerCollection; i += cfg.BatchSize {
		n := min(cfg.BatchSize, cfg.DocsPerCollection-i)
		batch := make([]any, n)
		for k := range batch {
			batch[k] = f.Make(i + k)
		}
		if _, err := col.InsertMany(ctx, batch, options.InsertMany().SetOrdered(false)); err != nil {
			return err
		}
	}
	nIdx := min(max(0, cfg.IndexesPerCollection), len(indexSpecs))
	if nIdx > 0 {
		models := make([]mongo.IndexModel, nIdx)
		for i := range models {
			models[i] = mongo.IndexModel{Keys: indexSpecs[i]}
		}
		if _, err := col.Indexes().CreateMany(ctx, models); err != nil {
			return err
		}
	}
	fmt.Printf("  done %s.%s (%d docs, %d idx)\n", dbName(cfg, d), collName(cfg, c), cfg.DocsPerCollection, nIdx)
	return nil
}

func listGenDBs(ctx context.Context, client *mongo.Client, cfg Config) ([]string, error) {
	all, err := client.ListDatabaseNames(ctx, bson.D{})
	if err != nil {
		return nil, err
	}
	var out []string
	for _, n := range all {
		if strings.HasPrefix(n, cfg.DBPrefix+"_") {
			out = append(out, n)
		}
	}
	sort.Strings(out)
	return out, nil
}

func num(v any) float64 {
	switch x := v.(type) {
	case int32:
		return float64(x)
	case int64:
		return float64(x)
	case float64:
		return x
	}
	return 0
}

func stats(ctx context.Context, client *mongo.Client, cfg Config) error {
	names, err := listGenDBs(ctx, client, cfg)
	if err != nil {
		return err
	}
	if len(names) == 0 {
		fmt.Printf("No DB with prefix %q\n", cfg.DBPrefix+"_")
		return nil
	}
	fmt.Printf("\n%-25s %6s %10s %10s %11s %9s\n", "DB", "colls", "objects", "dataMB", "storageMB", "indexMB")
	var tc, to, td, ts, ti float64
	for _, n := range names {
		var s bson.M
		if err := client.Database(n).RunCommand(ctx, bson.D{{Key: "dbStats", Value: 1}}).Decode(&s); err != nil {
			return err
		}
		c, o, d, st, ix := num(s["collections"]), num(s["objects"]), num(s["dataSize"]), num(s["storageSize"]), num(s["indexSize"])
		tc, to, td, ts, ti = tc+c, to+o, td+d, ts+st, ti+ix
		fmt.Printf("%-25s %6.0f %10.0f %10.2f %11.2f %9.2f\n", n, c, o, d/mb, st/mb, ix/mb)
	}
	fmt.Printf("%-25s %6.0f %10.0f %10.2f %11.2f %9.2f\n", "TOTAL", tc, to, td/mb, ts/mb, ti/mb)
	return nil
}

func clean(ctx context.Context, client *mongo.Client, cfg Config) error {
	names, err := listGenDBs(ctx, client, cfg)
	if err != nil {
		return err
	}
	for _, n := range names {
		if err := client.Database(n).Drop(ctx); err != nil {
			return err
		}
		fmt.Println("dropped", n)
	}
	if len(names) == 0 {
		fmt.Printf("No DB with prefix %q\n", cfg.DBPrefix+"_")
	}
	return nil
}
