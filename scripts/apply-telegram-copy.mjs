import mysql from "mysql2/promise";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

const entries = [
  [
    "welcome_message",
    [
      "Bienvenue chez Mister B.",
      "Ici, tu vas pouvoir accéder aux nouveautés, aux infos réservées et au contenu privé.",
      "Rejoins maintenant le canal privé ici → https://t.me/+sdIa7KNoIbNjMTg0",
      "",
      "Et si tu veux échanger directement avec moi, tu peux aussi me contacter ici : @MisterBNMB",
    ].join("\n"),
  ],
  [
    "telegram_reminder_15m_message",
    "Je te renvoie l’accès au canal privé Mister B. Tu y retrouveras les nouveautés, les infos réservées et le contenu partagé en privé. Rejoins-le maintenant ici → {group_url}",
  ],
  [
    "telegram_reminder_1h_message",
    "Je me permets de te renvoyer le lien du canal privé Mister B au cas où tu n’aurais pas eu le temps tout à l’heure. L’accès est toujours disponible ici → {group_url}",
  ],
  [
    "telegram_reminder_4h_message",
    "Le canal privé Mister B est toujours ouvert pour toi. Si tu veux voir les nouveautés et le contenu réservé, tu peux le rejoindre directement ici → {group_url}",
  ],
  [
    "telegram_reminder_24h_message",
    "Petit rappel : si tu n’as pas encore rejoint le canal privé Mister B, ton accès est toujours disponible. Tu peux entrer directement ici → {group_url}",
  ],
  [
    "telegram_reminder_1w_message",
    "Je te renvoie l’accès au canal privé Mister B pour cette semaine. Si tu voulais rejoindre mais que tu as repoussé, c’est le bon moment pour entrer → {group_url}",
  ],
  [
    "telegram_reminder_2w_message",
    "Je reviens vers toi avec le lien du canal privé Mister B. Si tu es toujours intéressé, tu peux rejoindre l’espace privé ici → {group_url}",
  ],
  [
    "telegram_reminder_1m_message",
    "Dernier rappel de ma part : si tu veux encore accéder au canal privé Mister B et aux infos réservées, voici le lien direct → {group_url}",
  ],
];

const connection = await mysql.createConnection(connectionString);

try {
  for (const [settingKey, settingValue] of entries) {
    await connection.execute(
      `
        INSERT INTO site_settings (setting_key, setting_value)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE
          setting_value = VALUES(setting_value),
          updated_at = CURRENT_TIMESTAMP
      `,
      [settingKey, settingValue],
    );
  }

  console.log(`Applied ${entries.length} Telegram copy settings.`);
} finally {
  await connection.end();
}
