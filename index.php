<?php
declare(strict_types=1);

header('Content-Type: text/html; charset=utf-8');
$app = __DIR__ . '/app.html';

if (!is_file($app) || !is_readable($app)) {
    http_response_code(500);
    echo '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Vitrine - instalação</title><body style="font:16px system-ui;max-width:680px;margin:48px auto;padding:20px"><h1>Arquivo principal da Vitrine não encontrado</h1><p>Envie <strong>app.html</strong> e <strong>vitrine-app.js</strong> para a mesma pasta pública deste arquivo index.php.</p></body></html>';
    exit;
}

readfile($app);
