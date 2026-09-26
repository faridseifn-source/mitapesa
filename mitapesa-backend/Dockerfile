FROM node:20-alpine

WORKDIR /app

# Prisma's query engine binary needs OpenSSL's actual shared library files
# present at runtime to dynamically link against — Alpine's base node
# image doesn't include these by default. This is what caused "Error
# loading shared library libssl.so.1.1: No such file or directory" even
# with the correct binaryTargets set in schema.prisma — specifying the
# right target alone doesn't create the underlying .so files it needs.
RUN apk add --no-cache openssl

COPY package.json ./
RUN npm install --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
COPY start.sh ./start.sh
RUN chmod +x start.sh

EXPOSE 4000
CMD ["./start.sh"]
