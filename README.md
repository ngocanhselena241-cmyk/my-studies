# Study Tracker

Web theo dõi tiến độ học tập một học kỳ: dashboard, checklist theo tuần, assessment,
grade calculator, lịch và thống kê giờ học. Có đăng nhập, dữ liệu lưu trên Cloudflare D1.

## Cấu trúc file

```
study-tracker/
├── public/                  ← phần chạy trong trình duyệt
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── functions/
│   └── api/
│       └── [[path]].js      ← API đăng nhập + lưu dữ liệu (chạy trên Cloudflare)
├── schema.sql               ← các bảng của database, chạy một lần duy nhất
├── wrangler.toml            ← chỉ cần khi muốn chạy thử API trên máy
└── .gitignore
```

Thư mục `functions/` là quy ước riêng của Cloudflare Pages: mọi file trong đó tự động
thành API, không cần cấu hình gì thêm. Tên `[[path]].js` nghĩa là "nhận mọi đường dẫn
bắt đầu bằng /api/".

---

## Phần 1 — Chạy trên máy bằng VS Code

### Cách nhanh: chỉ xem giao diện

Cài extension **Live Server** trong VS Code, chuột phải vào `public/index.html` →
**Open with Live Server**.

Sẽ không có API nên không đăng nhập được — bấm **"Dùng thử không cần tài khoản"**,
mọi tính năng đều chạy, dữ liệu lưu tạm trong trình duyệt.

### Cách đầy đủ: có cả đăng nhập

Cần Node.js (bạn đã cài rồi từ project trước). Mở Terminal trong VS Code
(`Ctrl + ~`), đứng ở thư mục project:

```bash
npx wrangler d1 execute study-tracker-db --local --file=schema.sql
npx wrangler pages dev
```

Mở link `http://localhost:8788` mà nó in ra. Đây là database **riêng trên máy**,
không đụng gì tới dữ liệu thật trên mạng.

---

## Phần 2 — Đưa lên GitHub

1. Vào github.com → **New repository** → đặt tên `study-tracker` → **Public** →
   **Create repository**
2. Ở trang repo vừa tạo, bấm **uploading an existing file**
3. Kéo thả **cả 4 thứ**: thư mục `public`, thư mục `functions`, file `schema.sql`,
   file `README.md`
4. Bấm **Commit changes**

Kiểm tra lại: trong repo phải thấy `functions/api/[[path]].js`. Nếu thiếu file này
thì đăng nhập sẽ không hoạt động.

---

## Phần 3 — Tạo database trên Cloudflare

1. Cloudflare dashboard → **Storage & databases** → **D1 SQLite Database**
2. **Create** → đặt tên `study-tracker-db` → **Create**
3. Bấm vào database vừa tạo → tab **Console**
4. Mở file `schema.sql`, copy **toàn bộ** nội dung, dán vào ô Console, bấm chạy
5. Kiểm tra: gõ lệnh sau vào Console rồi chạy

   ```sql
   SELECT name FROM sqlite_master WHERE type='table';
   ```

   Phải thấy `users`, `sessions`, `user_data`.

Không cần dùng Terminal ở bước này.

---

## Phần 4 — Tạo trang trên Cloudflare Pages

1. Sidebar → **Compute** → phần Pages → **Import an existing Git repository**
2. Chọn repo `study-tracker`
3. Màn hình cấu hình build:
   - Project name: đặt gì cũng được, **tên này chính là link** `<tên>.pages.dev`
   - Framework preset: **None**
   - Build command: **để trống**
   - Build output directory: `public`
4. **Save and Deploy**

Deploy xong sẽ hiện link `.pages.dev`. Mở thử — sẽ thấy màn hình đăng nhập,
nhưng **chưa đăng ký được**, vì database chưa được gắn vào. Sang bước tiếp.

---

## Phần 5 — Gắn database vào trang

1. Vào project vừa tạo → **Settings** → **Bindings** → **Add binding**
2. Chọn **D1 database**
3. Variable name: gõ chính xác `DB` — viết hoa, đúng hai chữ cái
4. D1 database: chọn `study-tracker-db`
5. **Save** (nếu hỏi cả Production và Preview thì chọn cả hai)
6. **Bắt buộc:** sang tab **Deployments** → bấm **Retry deployment** ở bản mới nhất

Bước 6 rất hay bị quên. Binding chỉ có hiệu lực từ lần deploy sau khi gắn.

---

## Phần 6 — Dùng thử

Mở link `.pages.dev` → **Tạo tài khoản** → đăng nhập → **Cài đặt** → nhập học kỳ
và thêm môn. Hoặc bấm **"Xem thử với dữ liệu mẫu"** ở màn hình trống để xem trước.

Bất kỳ ai có link đều tự đăng ký tài khoản riêng được, và mỗi người chỉ thấy
dữ liệu của mình.

---

## Sửa code sau này

Sửa file trong VS Code → đẩy lên GitHub (hoặc sửa thẳng trên web GitHub) →
Cloudflare tự deploy lại sau khoảng một phút. Không cần đụng lại database.

---

## Vài điều nên biết

**Mật khẩu** được băm bằng PBKDF2-SHA256, 30.000 vòng, mỗi tài khoản một salt riêng —
database không lưu mật khẩu gốc. Con số 30.000 chọn để vừa đủ mạnh mà vẫn nằm dưới
giới hạn 10ms CPU mỗi request của gói Cloudflare miễn phí. Dù vậy đây vẫn là project
cá nhân, không nên dùng lại mật khẩu quan trọng.

**Phiên đăng nhập** giữ 30 ngày, lưu trong cookie HttpOnly nên JavaScript của trang
không đọc được.

**Dữ liệu** của mỗi người lưu thành một khối JSON trong bảng `user_data`. Cách này
đơn giản và đủ nhanh với vài chục KB mỗi tài khoản. Nếu sau này cần truy vấn chéo
(ví dụ thống kê toàn bộ người dùng) thì mới cần tách thành nhiều bảng.

**Tự lưu** sau mỗi thay đổi khoảng 0,8 giây. Nhiều thay đổi liên tiếp gộp thành
một lần ghi. Góc trên bên phải hiện trạng thái: Đang lưu… / Đã lưu / Chưa lưu được.

**Giới hạn gói miễn phí:** 100.000 request/ngày, D1 5GB dung lượng và 100.000 dòng
ghi/ngày. Với vài chục người dùng thì còn rất xa mới chạm tới.

**Chưa có:** khôi phục mật khẩu khi quên, xác thực email, giới hạn số lần đăng nhập sai.
Nếu mở cho nhiều người dùng thật thì nên bổ sung.
