FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js bots.js ./
COPY prompts ./prompts
COPY public ./public

ENV PORT=8080
ENV DISABLE_PROXY=true
EXPOSE 8080

CMD ["node", "server.js"]
