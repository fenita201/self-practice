# 7. Kiểm tra dữ liệu sau sync

Chỉ so sánh khi **đã dừng ghi vào source** và mongosync ở trạng thái **`COMMITTED`**. Trong lúc
`RUNNING` mà source vẫn có ghi thì destination luôn chậm hơn một nhịp, nên số liệu lệch là bình thường.

Có ba mức kiểm tra, từ nhanh đến chặt:

| Mức | Công cụ | Bắt được |
|---|---|---|
| 1 | dung lượng theo DB (`dbStats`) | thiếu DB/collection, thiếu nhiều doc |
| 2 | `npm run compare` | thiếu/thừa collection, lệch số doc, lệch index (tên + key + option) |
| 3 | `HASH=true npm run compare` | **nội dung** khác nhau dù số doc bằng nhau |

Nếu migration bật embedded verifier, xem thêm trường `verification` trong `ms.sh progress`.

## 7.1 Mức 1: dung lượng từng DB

Chạy trên `lab-sync-1` (cần `mongosh`):

```bash
check_db_sizes() {
  mongosh "$1" --quiet --eval '
    const names = db.adminCommand({ listDatabases: 1, nameOnly: true }).databases
      .map(x => x.name)
      .filter(n => !["admin", "config", "local"].includes(n) && !n.startsWith("__mdb_internal"))
      .sort();
    console.table(names.map(name => {
      const s = db.getSiblingDB(name).runCommand({ dbStats: 1, scale: 1024 * 1024 });
      return { database: name, collections: s.collections, documents: s.objects,
               dataMB: +s.dataSize.toFixed(2), storageMB: +s.storageSize.toFixed(2),
               indexesMB: +s.indexSize.toFixed(2) };
    }));'
}

echo '=== SOURCE ==='; check_db_sizes "$SRC_URI"
echo '=== DESTINATION ==='; check_db_sizes "$DST_URI"
```

(`SRC_URI`/`DST_URI` export từ `tools/.env`, xem [05 §5.3](05-data-and-traffic.md#53-kiểm-tra-kết-nối).)

Đọc kết quả:

- `database`, `collections`, `documents` phải **giống hệt**;
- `dataMB` (BSON chưa nén) phải giống hoặc rất gần;
- `storageMB`, `indexesMB` **được phép khác**: phụ thuộc mức nén và cách cấp phát của
  WiredTiger, và destination vừa được ghi lại từ đầu nên thường gọn hơn.

## 7.2 Mức 2 + 3: `npm run compare`

```bash
cd ~/lab/tools
npm run compare                          # DB / collection / số doc / index
HASH=true npm run compare                # + dbHash: md5 nội dung từng collection
COMPARE_DB_REGEX=^synctest npm run compare
```

`compare` bỏ qua `admin`, `config`, `local` và DB nội bộ của mongosync (`__mdb_internal_mongosync`,
vẫn còn trên destination sau commit). Exit code `1` nếu có khác biệt, nên dùng được trong script.

Ví dụ thật khi làm lab: sau commit, cố ý insert 1 doc vào **mỗi** cụm. Số doc vẫn bằng nhau nên
mức 2 báo OK, nhưng mức 3 bắt được:

```text
src: 2 db / 6 coll / 19840 docs
dst: 2 db / 6 coll / 19840 docs

FAIL: 1 khac biet
  HASH differs   : synctest_db_001.coll_001 src=3e1fdfdb64a6d710070c2efdb3da43cf dst=2e76b38aab1e3d4f693f02f68b74e711
```

Bài học: **count khớp chưa chắc data khớp.**

Ghi chú:

- `dbHash` đọc toàn bộ collection và giữ lock trong lúc chạy, nên chậm với data lớn. Chỉ chạy khi
  không có traffic.
- Atlas: user cần quyền chạy `dbHash` (role `mongosyncDestination` kế thừa `atlasAdmin`). Nếu bị
  từ chối thì dừng ở mức 2. M0 thường không cho chạy `dbHash`.

## 7.3 Tìm doc khác nhau khi HASH lệch

```bash
NS_DB=synctest_db_001 NS_COLL=coll_001
for U in "$SRC_URI" "$DST_URI"; do
  mongosh "$U" --quiet --eval "
    const c = db.getSiblingDB('$NS_DB').getCollection('$NS_COLL');
    print(c.countDocuments(), JSON.stringify(c.find().sort({_id:-1}).limit(3).toArray().map(d => d._id)))"
done
```

Doc mới nhất (`_id` ObjectId lớn nhất) thường là doc được ghi sau commit, hoặc ghi thẳng vào
destination bằng user root trong lúc sync.

Tiếp theo: [Troubleshooting](08-troubleshooting.md) · [Dọn tài nguyên](09-cleanup.md).
