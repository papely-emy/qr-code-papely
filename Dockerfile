FROM nginx:alpine

# Remove config padrão (opcional mas bom)
RUN rm -rf /usr/share/nginx/html/*

# Copia tudo pro nginx
COPY . /usr/share/nginx/html

# Expõe porta 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]