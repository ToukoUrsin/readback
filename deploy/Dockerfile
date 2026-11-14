# The public copy: the page, the server and one finished tour. No generator, no GitHub.
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY shared shared
COPY server server
COPY web/dist web/dist
COPY data/kuitti-2/tour.json data/kuitti-2/tour.json
ENV PORT=8080 HOST=0.0.0.0 RB_KEEP=0
CMD ["bun", "server/index.ts"]
