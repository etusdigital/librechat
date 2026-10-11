FROM nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236
RUN apk add --no-cache openssl
COPY init.sh /init.sh
COPY edge.conf /etc/nginx/conf.d/default.conf
