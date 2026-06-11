FROM nginx:alpine

# Remove config padrão
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf

# Config personalizada
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copia apenas os arquivos HTML do frontend
COPY *.html /usr/share/nginx/html/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
