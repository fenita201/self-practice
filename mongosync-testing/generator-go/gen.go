package main

import (
	"fmt"
	"math/rand/v2"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

var (
	firstNames = []string{"An", "Binh", "Chi", "Dung", "Giang", "Hoa", "Khanh", "Lan", "Minh", "Nam", "Oanh", "Phuc", "Quang", "Son", "Thao", "Uyen", "Vy"}
	lastNames  = []string{"Nguyen", "Tran", "Le", "Pham", "Hoang", "Huynh", "Phan", "Vu", "Dang", "Bui", "Do", "Ngo"}
	statuses   = []string{"new", "active", "pending", "suspended", "closed"}
	tagList    = []string{"alpha", "beta", "gamma", "delta", "omega", "vip", "retail", "wholesale", "promo", "legacy"}
)

const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

type DocFactory struct {
	rng      *rand.Rand
	padBytes int
	pool     string
	now      time.Time
}

func newRng(seed uint64) *rand.Rand {
	return rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
}

func NewDocFactory(rng *rand.Rand, padBytes int) *DocFactory {
	f := &DocFactory{rng: rng, padBytes: padBytes, now: time.Now()}
	if padBytes > 0 {
		size := max(1<<20, padBytes*2)
		var sb strings.Builder
		sb.Grow(size)
		for i := 0; i < size; i++ {
			sb.WriteByte(b64[rng.IntN(64)])
		}
		f.pool = sb.String()
	}
	return f
}

func (f *DocFactory) pick(s []string) string { return s[f.rng.IntN(len(s))] }

func (f *DocFactory) payload() string {
	if f.padBytes <= 0 {
		return ""
	}
	start := f.rng.IntN(len(f.pool))
	if start+f.padBytes <= len(f.pool) {
		return f.pool[start : start+f.padBytes]
	}
	return f.pool[start:] + f.pool[:f.padBytes-(len(f.pool)-start)]
}

func (f *DocFactory) Make(idx int) bson.D {
	first, last := f.pick(firstNames), f.pick(lastNames)
	n := 2 + f.rng.IntN(3)
	tags := make([]string, n)
	for i := range tags {
		tags[i] = f.pick(tagList)
	}
	created := f.now.Add(-time.Duration(f.rng.Int64N(int64(365 * 24 * time.Hour))))
	return bson.D{
		{Key: "idx", Value: int32(idx)},
		{Key: "name", Value: first + " " + last},
		{Key: "email", Value: strings.ToLower(fmt.Sprintf("%s.%s%d@example.com", first, last, f.rng.IntN(100000)))},
		{Key: "status", Value: f.pick(statuses)},
		{Key: "amount", Value: float64(f.rng.IntN(1_000_000)) / 100},
		{Key: "createdAt", Value: bson.NewDateTimeFromTime(created)},
		{Key: "tags", Value: tags},
		{Key: "payload", Value: f.payload()},
	}
}

// Kich thuoc BSON trung binh cua doc khi payload rong (gom _id).
func sampleBaseDocBytes(seed uint64) float64 {
	f := NewDocFactory(newRng(seed), 0)
	const n = 500
	total := 0
	for i := 0; i < n; i++ {
		doc := f.Make(i)
		doc = append(bson.D{{Key: "_id", Value: bson.NewObjectID()}}, doc...)
		b, err := bson.Marshal(doc)
		if err != nil {
			panic(err)
		}
		total += len(b)
	}
	return float64(total) / n
}
