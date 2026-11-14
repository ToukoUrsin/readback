# The public copy: the page, the server, one finished tour and its short read. No generator, no GitHub.
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY shared shared
COPY server server
COPY web/dist web/dist
COPY data/live data/live
# /data is a Fly volume: what readers did survives a deploy
ENV PORT=8080 HOST=0.0.0.0 RB_DATA=/data
CMD ["bun", "server/index.ts"]
