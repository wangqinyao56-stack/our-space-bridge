FROM node:22-alpine

WORKDIR /app

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

EXPOSE 3456

CMD ["node", "server.js"]
