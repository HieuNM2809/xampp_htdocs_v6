# syntax=docker/dockerfile:1
#
# Một image dùng cho CẢ HAI service: order-service (mặc định) và payment-service
# (docker-compose.yml đổi lệnh chạy và OTEL_SERVICE_NAME).
#
#   docker build -t nodejs-signoz-demo:1.0.0 .
#   docker build --build-arg NODE_VERSION=24 -t nodejs-signoz-demo:1.0.0 .   # dùng Node 24 LTS

# Node 26 là bản Active LTS (tháng 11/2026). OpenTelemetry JS SDK 3.x cần Node >= 22.15.
ARG NODE_VERSION=26

# ---------- Stage 1: cài dependency ----------
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app

# Chỉ copy file khai báo dependency trước: code đổi mà dependency không đổi thì Docker dùng lại
# cache của bước npm ci, build lại rất nhanh.
COPY package.json package-lock.json ./

# npm ci: cài đúng phiên bản trong package-lock.json.
# --omit=dev: bỏ cross-env, concurrently (chỉ dùng khi chạy trên máy dev).
# Cache mount giữ thư mục cache của npm giữa các lần build, không lọt vào image.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

# ---------- Stage 2: image chạy thật ----------
FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Chỉ mang sang những gì cần để chạy: node_modules đã cài ở stage 1 và mã nguồn.
# Không --chown: file thuộc root, user "node" chỉ đọc được → app không tự sửa được code của chính nó.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts

# Image node:* có sẵn user "node" (uid 1000). Không chạy app bằng root.
USER node

# order-service 3400, payment-service 3401 (cổng trong container = cổng mở ra máy host).
EXPOSE 3400 3401

# Image slim không có curl/wget: healthcheck dùng chính node + fetch.
# PORT lấy từ biến môi trường của container mà docker-compose.yml đặt cho từng service.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3400) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# --require nạp tracing.js TRƯỚC server.js để auto-instrumentation kịp vá http, express, pino, fetch.
# Dạng exec (mảng JSON): node là PID 1, nhận thẳng SIGTERM từ `docker stop` để flush telemetry rồi thoát.
CMD ["node", "--require", "./src/tracing.js", "src/server.js"]
