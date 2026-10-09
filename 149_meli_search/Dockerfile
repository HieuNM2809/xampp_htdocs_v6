# Image cho ứng dụng Node.js của ví dụ (service "app" trong docker-compose.yml).
# Meilisearch dùng image chính thức getmeili/meilisearch, không build ở đây.
FROM node:22-alpine

WORKDIR /app

# Cài dependency ở lớp riêng để Docker cache lại khi chỉ có source thay đổi.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY data ./data

# Image node:* có sẵn user "node" (uid 1000). Không chạy bằng root.
USER node

# Mặc định: tạo index + nạp dữ liệu, rồi chạy toàn bộ demo.
CMD ["npm", "start"]
