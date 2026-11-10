# syntax=docker/dockerfile:1
ARG CLB_PHP_IMAGEN=php:8.4-cli-bookworm
FROM ${CLB_PHP_IMAGEN} AS base

RUN apt-get update \
    && apt-get install -y --no-install-recommends libonig-dev libssl-dev unzip $PHPIZE_DEPS \
    && docker-php-ext-install -j"$(nproc)" mbstring \
    && pecl install mongodb-2.5.0 \
    && docker-php-ext-enable mongodb \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
WORKDIR /var/www/clb_inventario

FROM base AS dependencias
COPY composer.json composer.lock ./
RUN --mount=type=cache,id=clb_composer,target=/tmp/clb_composer \
    COMPOSER_CACHE_DIR=/tmp/clb_composer COMPOSER_MAX_PARALLEL_HTTP=4 \
    composer install --no-dev --no-scripts --no-autoloader --no-interaction --prefer-dist --no-progress

FROM base AS archivos
COPY --from=dependencias /var/www/clb_inventario/vendor ./vendor
COPY . .
RUN mkdir -p bootstrap/cache storage/app/prendas storage/logs storage/framework/cache storage/framework/views \
    && composer dump-autoload --no-dev --classmap-authoritative --no-scripts \
    && php artisan package:discover --ansi \
    && chown -R www-data:www-data bootstrap/cache storage

RUN printf "upload_max_filesize=10M\npost_max_size=24M\n" > /usr/local/etc/php/conf.d/clb-recursos.ini

FROM archivos AS nube
RUN a2enmod rewrite \
    && sed -i 's|DocumentRoot /var/www/html|DocumentRoot /var/www/clb_inventario/public|' /etc/apache2/sites-available/000-default.conf \
    && printf '<Directory /var/www/clb_inventario/public>\n    AllowOverride All\n    Require all granted\n</Directory>\n' > /etc/apache2/conf-enabled/clb.conf \
    && sed -i 's/Listen 80$/Listen 8000/' /etc/apache2/ports.conf \
    && sed -i 's/VirtualHost \*:80>/VirtualHost *:8000>/' /etc/apache2/sites-available/000-default.conf
EXPOSE 8000
CMD ["apache2-foreground"]

FROM archivos AS aplicacion
USER www-data
EXPOSE 8000
# Servidor exclusivo para el entorno local de Compose; no es un despliegue cloud.
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000", "--no-reload"]
