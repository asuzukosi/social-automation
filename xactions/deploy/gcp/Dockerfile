FROM nginx:1.27-alpine
COPY deploy/gcp/nginx.conf /etc/nginx/conf.d/default.conf
# public/ first (og images, logo, demo assets), dashboard/ second so its
# robots.txt/sitemap.xml/manifest.json win on filename conflicts
COPY public/ /usr/share/nginx/html/
COPY dashboard/ /usr/share/nginx/html/
# Marketing landing page served at / (see nginx.conf)
COPY site/index.html /usr/share/nginx/html/landing.html
COPY llms.txt llms-full.txt /usr/share/nginx/html/
# Source trees can carry restrictive modes; nginx's worker needs world
# read on files and traverse on directories
RUN chmod -R a+rX /usr/share/nginx/html
EXPOSE 8080
