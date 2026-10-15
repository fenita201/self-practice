# 9. Dọn tài nguyên

VM, Cloud NAT và Atlas M10 tính tiền theo giờ, nên lab xong là dọn ngay.

## 9.1 Trước khi destroy

- Dừng connector, generator, mongosync.
- Lưu lại log nếu cần: `gcloud compute scp --tunnel-through-iap lab-sync-1:/var/log/mongosync/mongosync.log ./`

## 9.2 Destroy bằng Terragrunt

```bash
source infra/.env
cd infra/live
terragrunt run --all destroy      # đi ngược thứ tự phụ thuộc: Atlas cluster → Atlas project → VM → firewall → VPC
```

Hoặc từng unit, theo thứ tự ngược lúc tạo:

```bash
cd infra/live
for u in atlas/m10-cluster atlas/m10-project atlas/m0-cluster atlas/m0-project \
         gcp/sync-vm gcp/dst-vms gcp/src-vms gcp/key-pair gcp/firewall gcp/vpc gcp/project; do
  echo "=== $u"; (cd "$u" && terragrunt destroy) || break
done
```

Unit chưa từng apply sẽ báo không có gì để xoá, cứ bỏ qua. `gcp/project` chỉ bỏ quản lý các API
đã bật (không tắt API, không xoá project).

## 9.3 Xác nhận đã sạch

```bash
gcloud compute instances list
gcloud compute addresses list
gcloud compute routers list
gcloud compute networks list
```

Trong Atlas UI: không còn cluster/project `mongosync-lab-*`.

## 9.4 Xoá hẳn project và key

```bash
gcloud projects delete "$GCP_PROJECT_ID"      # kiểm tra kỹ project ID trước khi chạy
```

- Thu hồi Atlas API key trong *Organization Settings → API Keys*.
- Xoá file local: `infra/.env`, `~/.ssh/mongosync-lab*`, `infra/live/.state/`, `tools/.env`.

## 9.5 Lab local Docker

```bash
cd local && docker compose down -v      # -v xoá luôn volume data
```
