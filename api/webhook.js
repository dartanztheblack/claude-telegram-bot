import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Stockage en mémoire des conversations (reset à chaque cold start)
const conversations = new Map();

async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
}

async function sendTyping(chatId) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).json({ ok: true });

  const { message, callback_query } = req.body || {};
  const msg = message || callback_query?.message;
  if (!msg) return res.status(200).json({ ok: true });

  const chatId = msg.chat.id;
  const text = message?.text || callback_query?.data || "";
  const userId = msg.from?.id?.toString() || chatId.toString();

  // Commande /start ou /reset
  if (text === "/start" || text === "/reset") {
    conversations.delete(userId);
    await sendTelegram(chatId,
      `👋 *Bonjour !* Je suis Claude, ton assistant IA.\n\nJe peux t'aider avec :\n• Tes projets web (Versailles à Cheval, Alloyema, Louis XXI)\n• Du code, des textes, des analyses\n• N'importe quelle question\n\nEnvoie-moi un message !`
    );
    return res.status(200).json({ ok: true });
  }

  // /clear = reset conversation
  if (text === "/clear") {
    conversations.delete(userId);
    await sendTelegram(chatId, "✅ Conversation effacée. Nouveau départ !");
    return res.status(200).json({ ok: true });
  }

  if (!text || text.startsWith("/")) return res.status(200).json({ ok: true });

  // Récupérer l'historique
  const history = conversations.get(userId) || [];
  history.push({ role: "user", content: text });

  // Garder max 20 messages (10 échanges)
  if (history.length > 20) history.splice(0, history.length - 20);

  // Indiquer que le bot écrit
  await sendTyping(chatId);

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: `Tu es Claude, un assistant IA personnel. Tu aides Mikail Chebel avec ses projets.

Projets en cours :
- versaillesacheval.fr : Site de visites à cheval à Versailles (Vite+React, Vercel, Stripe, Supabase)
- alloyema.com : App de cuisine à domicile (React, Firebase)
- louis-xxi-blanc : Marque de luxe (Next.js, Firebase)

Réponds en français par défaut sauf si on te parle en anglais. Sois concis et direct.`,
      messages: history,
    });

    const reply = response.content[0].text;

    // Sauvegarder la réponse dans l'historique
    history.push({ role: "assistant", content: reply });
    conversations.set(userId, history);

    // Découper si > 4096 chars (limite Telegram)
    if (reply.length <= 4096) {
      await sendTelegram(chatId, reply);
    } else {
      const chunks = reply.match(/[\s\S]{1,4000}/g) || [];
      for (const chunk of chunks) {
        await sendTelegram(chatId, chunk);
      }
    }
  } catch (err) {
    console.error("Claude API error:", err);
    await sendTelegram(chatId, "❌ Erreur Claude API. Vérifie que ANTHROPIC_API_KEY est configuré sur Vercel.");
  }

  return res.status(200).json({ ok: true });
}