const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN';
const ADMIN_ID = 1056007305;

const adminStates = {};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = path.join(__dirname, 'data.json');

function loadData() {
    if (!fs.existsSync(DB_PATH)) {
        const initial = {
            visits: {},
            last24h: [],
            reviews: [
                { id: 1, name: "فهد العتيبي", text: "تاريخي ماشاء الله عليك", rating: 5, date: "2026-10-26" }
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

app.get('/api/reviews', (req, res) => {
    const data = loadData();
    res.json(data.reviews || []);
});

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

// دالة إيقاف دائرة تحميل الأزرار في تليجرام
function answerCallback(callbackQueryId) {
    if (BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN') return;
    const data = JSON.stringify({ callback_query_id: callbackQueryId });
    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${BOT_TOKEN}/answerCallbackQuery`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options, (res) => {});
    req.on('error', (e) => {});
    req.write(data);
    req.end();
}

// دالة إرسال رسائل تليجرام
function sendTelegramMessage(chatId, text, replyMarkup = null) {
    if (BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN') return;
    
    const data = JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
    });

    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };

    const req = https.request(options, (res) => {});
    req.on('error', (e) => {});
    req.write(data);
    req.end();
}

app.post(`/telegram-webhook`, async (req, res) => {
    const update = req.body;
    res.sendStatus(200);

    if (!update) return;

    if (update.message) {
        const msg = update.message;
        const chatId = msg.chat.id;
        const fromId = msg.from.id;
        const text = msg.text || '';

        if (fromId !== ADMIN_ID) {
            return sendTelegramMessage(chatId, "⚠️ غير مصرح لك باستخدام لوحة الإدارة.");
        }

        if (text === '/admin' || text === '/start') {
            delete adminStates[chatId];
            const keyboard = {
                inline_keyboard: [
                    [{ text: "📊 إحصائيات الزيارات", callback_data: "stats" }],
                    [{ text: "⏱️ زيارات آخر 24 ساعة", callback_data: "stats_24h" }],
                    [{ text: "➕ إضافة تقييم جديد", callback_data: "add_review_start" }],
                    [{ text: "⭐ إدارة وحذف التقييمات", callback_data: "manage_reviews" }]
                ]
            };
            return sendTelegramMessage(chatId, "<b>مرحباً بك في لوحة أدمن منصة العاقل 👑</b>\nاختر من القائمة أدناه:", keyboard);
        }

        if (adminStates[chatId]) {
            const state = adminStates[chatId];
            
            if (state.step === 'WAITING_FOR_NAME') {
                state.name = text;
                state.step = 'WAITING_FOR_TEXT';
                return sendTelegramMessage(chatId, `✍️ تمام (<b>${text}</b>).\nالآن أرسل <b>وصف التقييم</b> (رأي العميل):`);
            } 
            else if (state.step === 'WAITING_FOR_TEXT') {
                state.text = text;
                state.step = 'WAITING_FOR_RATING';
                
                const ratingKeyboard = {
                    inline_keyboard: [
                        [
                            { text: "⭐ 1", callback_data: "rate_1" },
                            { text: "⭐⭐ 2", callback_data: "rate_2" },
                            { text: "⭐⭐⭐ 3", callback_data: "rate_3" }
                        ],
                        [
                            { text: "⭐⭐⭐⭐ 4", callback_data: "rate_4" },
                            { text: "⭐⭐⭐⭐⭐ 5", callback_data: "rate_5" }
                        ]
                    ]
                };
                return sendTelegramMessage(chatId, "⭐ ممتاز، الآن اختر <b>عدد النجوم</b> من الأزرار بالأسفل:", ratingKeyboard);
            }
        }
    }

    if (update.callback_query) {
        const query = update.callback_query;
        const chatId = query.message.chat.id;
        const fromId = query.from.id;
        const dataCmd = query.data;
        const queryId = query.id;

        if (fromId !== ADMIN_ID) return;

        // إيقاف دائرة التحميل للزر فوراً
        answerCallback(queryId);

        const dbData = loadData();

        if (dataCmd === 'stats') {
            let statsText = "<b>📊 إحصائيات الزيارات حسب الأيام:</b>\n\n";
            const keys = Object.keys(dbData.visits || {}).sort().reverse();
            if (keys.length === 0) {
                statsText += "لا توجد زيارات مسجلة حتى الآن.";
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

        if (dataCmd === 'add_review_start') {
            adminStates[chatId] = { step: 'WAITING_FOR_NAME' };
            return sendTelegramMessage(chatId, "👤 <b>إضافة تقييم جديد</b>\n\nالرجاء إرسال <b>اسم العميل</b> في الرسالة التالية:");
        }

        if (dataCmd.startsWith('rate_')) {
            const rating = parseInt(dataCmd.replace('rate_', ''));
            const state = adminStates[chatId];
            
            if (state && state.step === 'WAITING_FOR_RATING') {
                const newReview = {
                    id: Date.now(),
                    name: state.name,
                    text: state.text,
                    rating: rating,
                    date: new Date().toISOString().split('T')[0]
                };
                
                dbData.reviews.unshift(newReview);
                saveData(dbData);
                delete adminStates[chatId];

                return sendTelegramMessage(chatId, `✅ <b>تم إضافة وحفظ التقييم بنجاح!</b>\n\n👤 <b>الاسم:</b> ${newReview.name}\n💬 <b>الوصف:</b> ${newReview.text}\n⭐ <b>التقييم:</b> ${'★'.repeat(rating)}\n\n<i>سيظهر في الموقع مباشرة الآن.</i>`);
            } else {
                return sendTelegramMessage(chatId, "⚠️ انتهت سياق الخطوات، الرجاء الضغط على زر (إضافة تقييم جديد) من البداية عبر /admin");
            }
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
            return sendTelegramMessage(chatId, `✅ تم حذف التقييم بنجاح.`);
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
