# 2. Dựng hạ tầng GCP (+ Atlas)

Phần này tạo VPC, firewall, SSH key và các VM bằng Terragrunt. Phần Atlas (nếu chọn B/C) chỉ cần
chuẩn bị API key ở đây; cluster Atlas được tạo ở [bước 4](04-destination.md).

## 2.1 Công cụ trên máy local

| Công cụ | Ghi chú |
|---|---|
| `gcloud` | Google Cloud CLI |
| Terraform ≥ 1.13 | module yêu cầu `required_version >= 1.13.0` |
| Terragrunt ≥ 0.9x (đã thử 1.1.6) | lệnh `terragrunt run --all ...` |
| `jq`, `openssl`, `curl`, `tar` | |

## 2.2 GCP project và billing

Tạo một project riêng cho lab để lúc dọn chỉ cần xoá project:

```bash
gcloud auth login
gcloud auth application-default login       # Terraform dùng credential này

export GCP_PROJECT_ID="mongosync-lab-$RANDOM"   # project ID phải duy nhất toàn cầu
gcloud projects create "$GCP_PROJECT_ID" --name="mongosync-lab"
gcloud billing accounts list
gcloud billing projects link "$GCP_PROJECT_ID" --billing-account="XXXXXX-XXXXXX-XXXXXX"
gcloud config set project "$GCP_PROJECT_ID"
gcloud config set compute/zone us-central1-a    # để các lệnh gcloud compute ... không cần --zone
```

Vào **Billing → Budgets & alerts** tạo budget alert. Budget chỉ gửi cảnh báo, **không tự tắt**
tài nguyên. Tài khoản mới có free trial credit; Always Free không đủ cho lab nhiều VM.

## 2.3 (B/C) Atlas API key

1. Atlas → **Organization Settings → Access Manager → API Keys** → tạo key quyền
   *Organization Project Creator* (hoặc *Organization Owner* cho lab cá nhân).
2. Thêm public IP của máy bạn vào **API Access List** của key.
3. Copy **Organization ID** ở *Organization Settings*.
4. M10 cần billing method trong Atlas; M0 thì không.

## 2.4 Biến môi trường

Repo không chứa ID hay key của ai: ID và secret chỉ nằm trong file `infra/.env` (đã
`.gitignore`), tạo từ template [`infra/.env.example`](../infra/.env.example):

```bash
cp infra/.env.example infra/.env
chmod 600 infra/.env
nano infra/.env
```

| Biến | Bắt buộc | Lấy ở đâu |
|---|---|---|
| `GCP_PROJECT_ID` | luôn | project tạo ở 2.2 |
| `ATLAS_ORG_ID` | B, C | Atlas → Organization Settings |
| `MONGODB_ATLAS_PUBLIC_KEY` / `MONGODB_ATLAS_PRIVATE_KEY` | B, C | API key ở 2.3 (provider Atlas đọc thẳng từ biến này) |
| `MY_PUBLIC_IP` | không | (C) thêm IP máy bạn vào whitelist M0, ví dụ `$(curl -s https://checkip.amazonaws.com)` |
| `TG_PROVIDER_CACHE=1` | có sẵn | Terragrunt tải provider một lần, dùng chung cho mọi unit |

Nạp biến vào shell (**mỗi lần mở terminal mới**):

```bash
source infra/.env
```

Không dùng `TF_PLUGIN_CACHE_DIR` của Terraform: khi `terragrunt run --all` init nhiều unit song
song sẽ gặp lỗi `cached package ... does not match any of the checksums`.

## 2.5 Terragrunt hoạt động thế nào trong repo này

```text
infra/
├── .env.example        # template biến môi trường (2.4)
├── modules/            # Terraform module dùng chung
└── live/
    ├── root.hcl        # mọi unit include: backend state local + input chung + đọc values.yaml
    ├── lab.yaml        # env=lab, region, zone, atlas_region (chung cho mọi unit)
    ├── gcp/
    │   ├── values.yaml # cấu hình của mọi unit GCP, mỗi unit một block
    │   ├── project/    # bật API compute + iap trên project có sẵn
    │   ├── vpc/        # lab-vpc, subnet mongo 10.20.0.0/24 + sync 10.21.0.0/24, Cloud NAT IP tĩnh
    │   ├── firewall/   # SSH từ IAP, 27017 nội bộ, ICMP nội bộ
    │   ├── key-pair/   # tạo ~/.ssh/mongosync-lab
    │   ├── src-vms/    # lab-src-1..3  (luôn cần)
    │   ├── dst-vms/    # lab-dst-1..3  (chỉ hướng A)
    │   └── sync-vm/    # lab-sync-1    (luôn cần)
    └── atlas/
        ├── values.yaml # cấu hình m10-project, m10-cluster, m0-project, m0-cluster
        └── m10-project/ m10-cluster/ m0-project/ m0-cluster/   # bước 4B / 4C
```

- Mỗi thư mục chứa `terragrunt.hcl` là một **unit** (một Terraform root riêng, state riêng).
- **Cấu hình nằm trong `values.yaml`**, mỗi block có tên trùng tên folder của unit:

  ```yaml
  # infra/live/gcp/values.yaml
  sync-vm:                       # <tên folder unit>
    machine_type: e2-standard-4  #   <config> = variable của module
    internal_ips: ["10.21.0.10"]
  ```

  `root.hcl` tự lấy block khớp với unit đang chạy rồi truyền làm `inputs`. Muốn đổi machine
  type, IP, CIDR, tên cluster... thì sửa `values.yaml`, không cần đụng `terragrunt.hcl`.
- Thứ tự gộp input (cái sau ghi đè cái trước): `lab.yaml` + `GCP_PROJECT_ID` → block trong
  `values.yaml` → `inputs` trong `terragrunt.hcl` của unit. `terragrunt.hcl` chỉ còn phần cần output
  của unit khác, ví dụ `subnet` = `self_link` lấy từ unit `vpc` theo `subnet_name` trong values.
  Khoá không phải variable của module (như `subnet_name`) bị Terraform bỏ qua.
- Xem input cuối cùng mà một unit nhận được:

  ```bash
  cd infra/live/gcp/sync-vm && terragrunt render --format json 2>/dev/null | grep '^{' | jq .inputs
  ```

- `dependency "vpc"` cho phép unit đọc output của unit khác. `mock_outputs` giúp `plan`/`render`
  chạy được khi unit phụ thuộc chưa apply.
- State nằm ở `infra/live/.state/<nhóm>/<unit>/terraform.tfstate` (đã `.gitignore`). **State chứa
  private key và password ở dạng plain text**, không gửi cho ai.

## 2.6 Tạo hạ tầng

Apply từng unit theo thứ tự. Cách này chậm hơn `run --all` nhưng bạn thấy rõ từng bước tạo gì:

```bash
source infra/.env          # từ thư mục gốc repo
cd infra/live/gcp
for u in project vpc firewall key-pair src-vms sync-vm; do
  echo "=== $u"; (cd "$u" && terragrunt apply) || break
done

# Chỉ hướng (A): thêm 3 VM đích
(cd dst-vms && terragrunt apply)
```

Mỗi lần `apply` sẽ in plan và hỏi `yes`. **Đọc plan trước khi gõ yes**: phải là VM không có
public IP, đúng số lượng, đúng machine type.

Cách nhanh (tạo mọi unit trong `gcp/`, kể cả `dst-vms`):

```bash
cd infra/live/gcp && terragrunt run --all apply
```

Xem kết quả:

```bash
gcloud compute instances list
(cd infra/live/gcp/vpc && terragrunt output nat_ip)    # IP NAT, dùng cho M0 ở bước 4C
```

## 2.7 SSH vào VM qua IAP

VM không có public IP. SSH đi qua Identity-Aware Proxy (firewall đã mở `35.235.240.0/20`):

```bash
gcloud compute ssh lab-src-1 --tunnel-through-iap
gcloud compute scp --tunnel-through-iap ./file lab-src-1:/tmp/
```

Lần đầu gcloud sẽ tạo key riêng `~/.ssh/google_compute_engine`. Muốn dùng `ssh` thường với key
lab (`~/.ssh/mongosync-lab`, user `ubuntu`) thì cần proxy qua IAP:

```bash
ssh -i ~/.ssh/mongosync-lab \
  -o ProxyCommand="gcloud compute start-iap-tunnel %n 22 --listen-on-stdin --zone us-central1-a" \
  ubuntu@lab-src-1
```

Kiểm tra mạng nội bộ từ `lab-sync-1`:

```bash
gcloud compute ssh lab-sync-1 --tunnel-through-iap --command 'ping -c 2 10.20.0.11'
```

VM đã ra Internet được qua Cloud NAT (để `apt-get`, tải mongosync), không cần public IP.

Tiếp theo: [Cluster nguồn trên VM](03-source-cluster.md).
