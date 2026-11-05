<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');

function respond(array $data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function require_login(): int
{
    if (empty($_SESSION['user_id'])) {
        respond(['ok' => false, 'error' => 'Entre na sua conta para continuar.'], 401);
    }
    return (int) $_SESSION['user_id'];
}

function read_json(): array
{
    $length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length > 32768) {
        respond(['ok' => false, 'error' => 'A solicitação excedeu o tamanho permitido.'], 413);
    }
    $contentType = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
    if ($contentType !== 'application/json') {
        respond(['ok' => false, 'error' => 'A solicitação precisa usar application/json.'], 415);
    }
    try {
        $data = json_decode((string) file_get_contents('php://input'), true, 32, JSON_THROW_ON_ERROR);
    } catch (JsonException $exception) {
        respond(['ok' => false, 'error' => 'O corpo da solicitação contém JSON inválido.'], 400);
    }
    if (!is_array($data)) {
        respond(['ok' => false, 'error' => 'O corpo da solicitação precisa ser um objeto JSON.'], 400);
    }
    return $data;
}

function required_text(array $data, string $key, int $maximum, string $label): string
{
    $value = trim((string) ($data[$key] ?? ''));
    if ($value === '' || strlen($value) > $maximum) {
        respond(['ok' => false, 'error' => "$label é obrigatório e deve respeitar o limite de tamanho."], 422);
    }
    return $value;
}

function current_user(mysqli $connection, int $userId): array
{
    $statement = $connection->prepare(
        'SELECT id, email, full_name, reply_email, service_description, portfolio_url
         FROM users WHERE id = ? LIMIT 1'
    );
    $statement->bind_param('i', $userId);
    $statement->execute();
    $user = $statement->get_result()->fetch_assoc();
    $statement->close();
    if (!$user) {
        unset($_SESSION['user_id']);
        respond(['ok' => false, 'error' => 'A conta não está mais disponível. Entre novamente.'], 401);
    }
    $user['id'] = (int) $user['id'];
    return $user;
}

try {
    require_once __DIR__ . '/config.php';

    $https = (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_name('VITRINESESSID');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $https,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    if (!session_start()) {
        throw new RuntimeException('Não foi possível iniciar a sessão.');
    }

    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $action = (string) ($_GET['action'] ?? '');
    if (!in_array($action, ['session', 'login', 'register', 'logout', 'save_profile', 'list_leads', 'save_lead', 'update_lead', 'delete_lead'], true)) {
        respond(['ok' => false, 'error' => 'Ação não encontrada.'], 404);
    }

    if ($method !== 'GET') {
        $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
        if ($origin !== '') {
            $originHost = parse_url($origin, PHP_URL_HOST);
            $requestHost = $_SERVER['HTTP_HOST'] ?? '';
            if (!is_string($originHost) || strcasecmp($originHost, $requestHost) !== 0) {
                respond(['ok' => false, 'error' => 'Origem da solicitação não autorizada.'], 403);
            }
        }
        if (strtolower((string) ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '')) === 'cross-site') {
            respond(['ok' => false, 'error' => 'Origem da solicitação não autorizada.'], 403);
        }
        if ($method !== 'POST') {
            header('Allow: GET, POST');
            respond(['ok' => false, 'error' => 'Método não permitido.'], 405);
        }
    } elseif (in_array($action, ['session', 'list_leads'], true) === false) {
        header('Allow: POST');
        respond(['ok' => false, 'error' => 'Método não permitido.'], 405);
    }

    $connection = $conexao;

    if ($action === 'session') {
        $userId = (int) ($_SESSION['user_id'] ?? 0);
        respond(['ok' => true, 'user' => $userId ? current_user($connection, $userId) : null]);
    }

    if ($action === 'register' || $action === 'login') {
        $data = read_json();
        $email = strtolower(trim((string) ($data['email'] ?? '')));
        $password = (string) ($data['password'] ?? '');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
            respond(['ok' => false, 'error' => 'Informe um endereço de e-mail válido.'], 422);
        }
        if (strlen($password) < 10 || strlen($password) > 72) {
            respond(['ok' => false, 'error' => 'A senha precisa ter de 10 a 72 bytes.'], 422);
        }

        if ($action === 'register') {
            $passwordHash = password_hash($password, PASSWORD_DEFAULT);
            $statement = $connection->prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)');
            $statement->bind_param('ss', $email, $passwordHash);
            try {
                $statement->execute();
            } catch (mysqli_sql_exception $exception) {
                $statement->close();
                if ((int) $exception->getCode() === 1062) {
                    respond(['ok' => false, 'error' => 'Já existe uma conta com este e-mail. Entre ou use outro endereço.'], 409);
                }
                throw $exception;
            }
            $userId = (int) $connection->insert_id;
            $statement->close();
        } else {
            $statement = $connection->prepare('SELECT id, password_hash FROM users WHERE email = ? LIMIT 1');
            $statement->bind_param('s', $email);
            $statement->execute();
            $account = $statement->get_result()->fetch_assoc();
            $statement->close();
            if (!$account || !password_verify($password, $account['password_hash'])) {
                respond(['ok' => false, 'error' => 'E-mail ou senha incorretos.'], 401);
            }
            $userId = (int) $account['id'];
        }

        session_regenerate_id(true);
        $_SESSION['user_id'] = $userId;
        respond(['ok' => true, 'user' => current_user($connection, $userId)]);
    }

    if ($action === 'logout') {
        read_json();
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $parameters = session_get_cookie_params();
            setcookie(session_name(), '', [
                'expires' => time() - 42000,
                'path' => $parameters['path'],
                'domain' => $parameters['domain'],
                'secure' => $parameters['secure'],
                'httponly' => $parameters['httponly'],
                'samesite' => 'Lax',
            ]);
        }
        session_destroy();
        respond(['ok' => true]);
    }

    $userId = require_login();

    if ($action === 'save_profile') {
        $data = read_json();
        $fullName = required_text($data, 'full_name', 120, 'Seu nome');
        $service = required_text($data, 'service_description', 200, 'A descrição do serviço');
        $replyEmail = trim((string) ($data['reply_email'] ?? ''));
        $portfolio = trim((string) ($data['portfolio_url'] ?? ''));
        if (strlen($replyEmail) > 254 || ($replyEmail !== '' && !filter_var($replyEmail, FILTER_VALIDATE_EMAIL))) {
            respond(['ok' => false, 'error' => 'Informe um e-mail válido para contato.'], 422);
        }
        if (strlen($portfolio) > 2048 || ($portfolio !== '' && !filter_var($portfolio, FILTER_VALIDATE_URL))) {
            respond(['ok' => false, 'error' => 'Informe um link de portfólio válido.'], 422);
        }
        $statement = $connection->prepare(
            'UPDATE users SET full_name = ?, reply_email = ?, service_description = ?, portfolio_url = ? WHERE id = ?'
        );
        $statement->bind_param('ssssi', $fullName, $replyEmail, $service, $portfolio, $userId);
        $statement->execute();
        $statement->close();
        respond(['ok' => true, 'profile' => current_user($connection, $userId)]);
    }

    if ($action === 'list_leads') {
        $statement = $connection->prepare(
            'SELECT id, osm_type, osm_id, name, category, address, city, email, phone,
                    latitude, longitude, source_url, status, notes, created_at, updated_at
             FROM prospects WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1000'
        );
        $statement->bind_param('i', $userId);
        $statement->execute();
        $leads = $statement->get_result()->fetch_all(MYSQLI_ASSOC);
        $statement->close();
        foreach ($leads as &$lead) {
            $lead['id'] = (int) $lead['id'];
            $lead['osm_id'] = (int) $lead['osm_id'];
            $lead['latitude'] = $lead['latitude'] === null ? null : (float) $lead['latitude'];
            $lead['longitude'] = $lead['longitude'] === null ? null : (float) $lead['longitude'];
        }
        unset($lead);
        respond(['ok' => true, 'leads' => $leads]);
    }

    if ($action === 'save_lead') {
        $data = read_json();
        $osmType = (string) ($data['osm_type'] ?? '');
        $osmId = filter_var($data['osm_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if (!in_array($osmType, ['node', 'way', 'relation'], true) || $osmId === false) {
            respond(['ok' => false, 'error' => 'Identificador OpenStreetMap inválido. Faça a busca novamente.'], 422);
        }
        $name = required_text($data, 'name', 300, 'O nome da loja');
        $category = trim((string) ($data['category'] ?? ''));
        $address = trim((string) ($data['address'] ?? ''));
        $city = trim((string) ($data['city'] ?? ''));
        $email = trim((string) ($data['email'] ?? ''));
        $phone = trim((string) ($data['phone'] ?? ''));
        $latitude = filter_var($data['latitude'] ?? null, FILTER_VALIDATE_FLOAT);
        $longitude = filter_var($data['longitude'] ?? null, FILTER_VALIDATE_FLOAT);
        $limits = ['category' => 120, 'address' => 1000, 'city' => 200, 'email' => 254, 'phone' => 100];
        foreach ($limits as $field => $limit) {
            if (strlen($$field) > $limit) {
                respond(['ok' => false, 'error' => 'Um dos campos da loja ultrapassou o tamanho permitido.'], 422);
            }
        }
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $email = '';
        }
        if ($latitude === false || $latitude < -90 || $latitude > 90) $latitude = null;
        if ($longitude === false || $longitude < -180 || $longitude > 180) $longitude = null;
        $sourceUrl = 'https://www.openstreetmap.org/' . $osmType . '/' . $osmId;
        $statement = $connection->prepare(
            'INSERT IGNORE INTO prospects
             (user_id, osm_type, osm_id, name, category, address, city, email, phone, latitude, longitude, source_url, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $emptyNotes = '';
        $statement->bind_param(
            'isissssssddss',
            $userId,
            $osmType,
            $osmId,
            $name,
            $category,
            $address,
            $city,
            $email,
            $phone,
            $latitude,
            $longitude,
            $sourceUrl,
            $emptyNotes
        );
        $statement->execute();
        $statement->close();
        respond(['ok' => true, 'saved' => true]);
    }

    if ($action === 'update_lead') {
        $data = read_json();
        $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $status = (string) ($data['status'] ?? '');
        $notes = trim((string) ($data['notes'] ?? ''));
        $allowedStatuses = ['new', 'contacted', 'replied', 'not_interested', 'customer'];
        if ($id === false || !in_array($status, $allowedStatuses, true) || strlen($notes) > 4000) {
            respond(['ok' => false, 'error' => 'Status ou notas inválidos.'], 422);
        }
        $statement = $connection->prepare('UPDATE prospects SET status = ?, notes = ? WHERE id = ? AND user_id = ?');
        $statement->bind_param('ssii', $status, $notes, $id, $userId);
        $statement->execute();
        $updated = $statement->affected_rows;
        $statement->close();
        if ($updated === 0) {
            $check = $connection->prepare('SELECT id FROM prospects WHERE id = ? AND user_id = ? LIMIT 1');
            $check->bind_param('ii', $id, $userId);
            $check->execute();
            $exists = (bool) $check->get_result()->fetch_assoc();
            $check->close();
            if (!$exists) respond(['ok' => false, 'error' => 'Contato não encontrado na sua conta.'], 404);
        }
        respond(['ok' => true]);
    }

    if ($action === 'delete_lead') {
        $data = read_json();
        $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($id === false) respond(['ok' => false, 'error' => 'Identificador de contato inválido.'], 422);
        $statement = $connection->prepare('DELETE FROM prospects WHERE id = ? AND user_id = ?');
        $statement->bind_param('ii', $id, $userId);
        $statement->execute();
        $deleted = $statement->affected_rows;
        $statement->close();
        if ($deleted !== 1) respond(['ok' => false, 'error' => 'Contato não encontrado na sua conta.'], 404);
        respond(['ok' => true]);
    }

    respond(['ok' => false, 'error' => 'Ação não encontrada.'], 404);
} catch (mysqli_sql_exception $exception) {
    error_log('Vitrine API database error: ' . $exception->getMessage());
    respond(['ok' => false, 'error' => 'Falha no banco MySQL. Confira as credenciais em config.php e importe database.sql pelo phpMyAdmin do AeonFree.'], 500);
} catch (Throwable $exception) {
    error_log('Vitrine API error: ' . $exception->getMessage());
    respond(['ok' => false, 'error' => 'O servidor não está configurado. Confira config.php, a extensão MySQLi e os arquivos enviados ao AeonFree.'], 500);
}
