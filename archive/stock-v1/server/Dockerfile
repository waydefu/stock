# Trusted market-data proxy image: dependency-free Node 24 static files only.
# No secrets baked in: FUGLE_API_KEY must come from the runtime secret store.
FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /srv/market-proxy

COPY package.json ./
COPY js/ ./js/
COPY server/ ./server/

RUN chown -R node:node /srv/market-proxy
USER node

ENV PORT=8787
ENV HOST=0.0.0.0
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/healthz').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "server/start-market-proxy.js"]
