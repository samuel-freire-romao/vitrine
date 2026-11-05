SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(120) NOT NULL DEFAULT '',
  reply_email VARCHAR(254) NOT NULL DEFAULT '',
  service_description VARCHAR(200) NOT NULL DEFAULT 'criação de sites profissionais',
  portfolio_url VARCHAR(2048) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_email_unique (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prospects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  osm_type ENUM('node', 'way', 'relation') NOT NULL,
  osm_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(300) NOT NULL,
  category VARCHAR(120) NOT NULL DEFAULT '',
  address VARCHAR(1000) NOT NULL DEFAULT '',
  city VARCHAR(200) NOT NULL DEFAULT '',
  email VARCHAR(254) NOT NULL DEFAULT '',
  phone VARCHAR(100) NOT NULL DEFAULT '',
  latitude DOUBLE DEFAULT NULL,
  longitude DOUBLE DEFAULT NULL,
  source_url VARCHAR(500) NOT NULL,
  status ENUM('new', 'contacted', 'replied', 'not_interested', 'customer') NOT NULL DEFAULT 'new',
  notes TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY prospects_user_osm_unique (user_id, osm_type, osm_id),
  KEY prospects_user_updated (user_id, updated_at),
  CONSTRAINT prospects_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
