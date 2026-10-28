# syntax=docker/dockerfile:1
FROM php:8.4-cli-bookworm AS base

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

FROM base AS aplicacion
COPY --from=dependencias /var/www/clb_inventario/vendor ./vendor
COPY . .
RUN mkdir -p bootstrap/cache storage/app/prendas storage/logs storage/framework/cache storage/framework/views \
    && composer dump-autoload --no-dev --classmap-authoritative --no-scripts \
    && php artisan package:discover --ansi \
    && chown -R www-data:www-data bootstrap/cache storage

RUN printf "upload_max_filesize=10M\npost_max_size=24M\n" > /usr/local/etc/php/conf.d/clb-recursos.ini

USER www-data
EXPOSE 8000
# Servidor exclusivo para el entorno local de Compose; no es un despliegue cloud.
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000", "--no-reload"]
