FROM node:22-alpine

WORKDIR /app

# mihomo (clash meta 内核) 作为旁路代理，供聚梦请求走机场出口 IP
RUN apk add --no-cache wget && \
    wget -q "https://github.com/MetaCubeX/mihomo/releases/download/v1.19.31/mihomo-linux-amd64-compatible-v1.19.31.gz" -O /tmp/mihomo.gz && \
    gunzip /tmp/mihomo.gz && \
    mv /tmp/mihomo /usr/local/bin/mihomo && \
    chmod +x /usr/local/bin/mihomo && \
    apk del wget

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=3456
ENV DATA_DIR=/data
ENV DISCOVER_DIR=/data/discover
ENV MEMORY_DIR=/data/memory
ENV DIARY_DIR=/data/diary
ENV ALBUM_DIR=/data/album
ENV HOST=0.0.0.0

ARG ARK_API_KEY
ENV ARK_API_KEY=$ARK_API_KEY

EXPOSE 3456

# Copy static audio/video assets to the persistent data volume (only if not already present)
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

CMD ["/app/entrypoint.sh"]
