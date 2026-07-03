# KRELL — no build step; install production deps and run the Node server.
FROM node:20-alpine

WORKDIR /app

# pnpm 9 (matches lockfileVersion 9.0 in pnpm-lock.yaml)
RUN npm install -g pnpm@9

# Install only production deps (skips playwright) using the committed lockfile
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# App source
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
