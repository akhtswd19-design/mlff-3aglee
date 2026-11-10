const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// إعدادات التليجرام
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN'; // ضع توكن البوت هنا
const ADMIN_ID = 1056007305;
const EXTERNAL_STORE_URL = 'https://threeagle-1.onrender.com';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// قواعد البيانات البسيطة (ملفات JSON)
const DB_PATH = path.join(__dirname, 'data.json');

function loadData() {
    if (!fs.existsSync(DB_PATH)) {
        const initial = {
            visits: {},
            last24h: [],
            reviews: [
                { id: 1, name: "فهد العتيبي", text: "ملفات ممتازة وشاملة جداً للتقديمات، أنصح بها وبشدة!", rating: 5 },
                { id: 2, name: "محمد الشمري", text: "أفضل مصادر لمذاكرة اختبار الكفايات والمقابلات الشخصية.", rating: 5 },
                { id: 3, name: "عبدالرحمن المطيري", text: "تحديثات مستمرة وتجاوب سريع، العاقل مضمون والحمد لله.", rating: 5 }
            ]
        };
        fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
        return initial;
    }
    return JSON.parse(fs.readFileSync(DB_PATH));
}

function saveData(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// مزامنة التقييمات من المتجر الخارجي تلقائياً
async function syncReviewsFromStore() {
    try {
        const response = await fetch(`${EXTERNAL_STORE_URL}/api/reviews`);
        if (response.ok) {
            const externalReviews = await response.json();
            const data = loadData();
            if (Array.isArray(externalReviews) && externalReviews.length > 0) {
                data.reviews = externalReviews;
                saveData(data);
                console.log('تم تحديث التقييمات من المتجر الخارجي بنجاح');
            }
        }
    } catch (err) {
        console.log('جاري استخدام التقييمات المحلية (تعذر الاتصال بالمتجر الخارجي):', err.message);
    }
}
syncReviewsFromStore();

// تسجيل الزيارات
app.post('/api/visit', (req, res) => {
    const data = loadData();
    const today = new Date().toISOString().split('T')[0];
    const now = Date.now();

    data.visits[today] = (data.visits[today] || 0) + 1;
    data.last24h = (data.last24h || []).filter(timestamp => now - timestamp < 24 * 60 * 60 * 1000);
    data.last24h.push(now);

    saveData(data);
    res.json({ success: true });
});

// إرجاع التقييمات للموقع
app.get('/api/reviews', (req, res) => {
    const data = loadData();
    res.json(data.reviews || []);
});

// معالجة أوامر التليجرام /admin
async function sendTelegramMessage(chatId, text, replyMarkup = null) {
    if (BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN') return;
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML',
                reply_markup: replyMarkup
            })
        });
    } catch (e) {
        console.error('Telegram API Error:', e);
    }
}

app.post(`/telegram-webhook`, async (req, res) => {
    const update = req.body;
    res.sendStatus(200);

    if (!update) return;

    // التعامل مع الرسائل النصية
    if (update.message) {
        const msg = update.message;
        const chatId = msg.chat.id;
        const fromId = msg.from.id;
        const text = msg.text || '';

        if (fromId !== ADMIN_ID) {
            return sendTelegramMessage(chatId, "⚠️ غير مصرح لك باستخدام لوحة الإدارة.");
        }

        if (text === '/admin' || text === '/start') {
            const keyboard = {
                inline_keyboard: [
                    [{ text: "📊 إحصائيات الزيارات", callback_data: "stats" }],
                    [{ text: "⏱️ زيارات آخر 24 ساعة", callback_data: "stats_24h" }],
                    [{ text: "⭐ إدارة وحذف التقييمات", callback_data: "manage_reviews" }]
                ]
            };
            return sendTelegramMessage(chatId, "<b>مرحباً بك في لوحة أدمن منصة العاقل 👑</b>\nاختر من القائمة أدناه:", keyboard);
        }
    }

    // التعامل مع ضغط الأزرار (Callback Queries)
    if (update.callback_query) {
        const query = update.callback_query;
        const chatId = query.message.chat.id;
        const fromId = query.from.id;
        const dataCmd = query.data;

        if (fromId !== ADMIN_ID) return;

        const dbData = loadData();

        if (dataCmd === 'stats') {
            let statsText = "<b>📊 إحصائيات الزيارات حسب الأيام:</b>\n\n";
            const keys = Object.keys(dbData.visits).sort().reverse();
            if (keys.length === 0) {
                statsText += "لا يوجد زيارات مسجلة بعد.";
            } else {
                keys.slice(0, 10).forEach(date => {
                    statsText += `🗓️ <b>${date}:</b> ${dbData.visits[date]} زيارة\n`;
                });
            }
            return sendTelegramMessage(chatId, statsText);
        }

        if (dataCmd === 'stats_24h') {
            const now = Date.now();
            const count24h = (dbData.last24h || []).filter(ts => now - ts < 24 * 60 * 60 * 1000).length;
            return sendTelegramMessage(chatId, `⏱️ <b>عدد الزوار خلال الـ 24 ساعة الماضية:</b>\n\n🔥 <code>${count24h}</code> زائر`);
        }

        if (dataCmd === 'manage_reviews') {
            if (!dbData.reviews || dbData.reviews.length === 0) {
                return sendTelegramMessage(chatId, "لا توجد تقييمات حالياً.");
            }
            let buttons = dbData.reviews.map(r => [{
                text: `❌ حذف: (${r.name} - ${r.rating}⭐)`,
                callback_data: `del_rev_${r.id}`
            }]);
            return sendTelegramMessage(chatId, "<b>🗑️ اضغط على التقييم الذي تريد حذفه:</b>", { inline_keyboard: buttons });
        }

        if (dataCmd.startsWith('del_rev_')) {
            const revId = parseInt(dataCmd.replace('del_rev_', ''));
            dbData.reviews = dbData.reviews.filter(r => r.id !== revId);
            saveData(dbData);
            return sendTelegramMessage(chatId, `✅ تم حذف التقييم رقم #${revId} بنجاح.`);
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});