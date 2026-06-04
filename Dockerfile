FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=3456
ENV DATA_DIR=/data
ENV HOST=0.0.0.0

RUN mkdir -p /data

EXPOSE 3456

CMD ["node", "server.js"]
