FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=3456
ENV DATA_DIR=/data1
ENV DISCOVER_DIR=/data1/discover
ENV MEMORY_DIR=/data1/memory
ENV DIARY_DIR=/data1/diary
ENV ALBUM_DIR=/data1/album
ENV HOST=0.0.0.0

RUN mkdir -p /data

EXPOSE 3456

CMD ["node", "server.js"]
