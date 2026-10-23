# กล่องฝากไฟล์ (beersbox)

ส่งไฟล์ ลิงก์ และข้อความข้ามคอมพิวเตอร์ด้วยรหัส 8 ตัว เปิดผ่านเบราว์เซอร์ได้เลย ไม่ต้องติดตั้งโปรแกรม ไม่ต้องเข้าสู่ระบบ

เปิดใช้: https://titiwutnav-web.github.io/

- หน้าเว็บอยู่บน GitHub Pages (repo นี้) ไฟล์ที่ฝากเก็บใน repo `beersbox-data`
- ไฟล์ถูกเข้ารหัส (AES-GCM) ในเบราว์เซอร์ด้วยกุญแจที่สร้างจากรหัส 8 ตัว ใน GitHub มีแต่ข้อมูลที่เข้ารหัสแล้ว
- ฝั่งส่งใช้รหัสผ่านสำหรับส่ง (ปลดล็อก GitHub token ที่เก็บแบบเข้ารหัสใน `beersbox-data/config.json`) ฝั่งรับใช้แค่รหัส 8 ตัว
- ของที่หมดเวลาถูกลบโดย GitHub Actions ใน `beersbox-data` ทุก 3 ชั่วโมง
- ส่งได้ครั้งละไม่เกิน 200 MB

## ตั้งค่าครั้งแรก

1. สร้าง repo สาธารณะชื่อ `beersbox-data` ใส่ไฟล์จากโฟลเดอร์ `data-repo/`
2. เปิด GitHub Pages ของ repo นี้ (ชื่อ repo `titiwutnav-web.github.io`, Settings → Pages → Deploy from branch → `main` / root)
3. สร้าง fine-grained token ที่เข้าถึงเฉพาะ `beersbox-data` สิทธิ์ Contents: Read and write
4. เปิดหน้าเว็บ ใส่ token และตั้งรหัสผ่านสำหรับส่ง

ถ้า token หมดอายุ: ลบ `config.json` ใน `beersbox-data` แล้วทำขั้นที่ 3–4 ใหม่
