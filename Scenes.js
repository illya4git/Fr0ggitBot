import { Scenes, Markup } from 'telegraf';
import Calendar from 'telegraf-calendar-telegram';
import { Group, User, UserGroups, Lesson, Subject, sequelize } from "./Models.js";
import { Op } from 'sequelize';

async function getLessonsForDate(groupId, date) {
    const targetDate = new Date(date);
    
    const dayNames = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const dayOfWeek = dayNames[targetDate.getDay()];
    
    const firstDayOfYear = new Date(targetDate.getFullYear(), 0, 1);
    const pastDaysOfYear = (targetDate - firstDayOfYear) / 86400000;
    const weekNumber = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
    const weekType = (weekNumber % 2 !== 0) ? 'first' : 'second';

    const lessons = await Lesson.findAll({
        where: {
            GroupId: groupId,
            day: dayOfWeek,
            weekType: weekType
        },
        include: {
            model: Subject,
            required: true
        },
        order: [['timestamp', 'ASC']]
    });

    return lessons;
}

async function getKeyboardForDate(groupId, date) {
    const lessons = await getLessonsForDate(groupId, date);

    const prev = new Date(date);
    prev.setDate(prev.getDate() - 1);
    const prevDate = prev.toISOString().slice(0, 10);

    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    const nextDate = next.toISOString().slice(0, 10);

    const lessonButtons = lessons.map(lesson => {
        const lessonText = `${lesson.timestamp} - ${lesson.Subject.name}`;
        return [Markup.button.callback(lessonText, `sub_${lesson.id}`)];
    });

    return Markup.inlineKeyboard([
        ...lessonButtons,
        [
            Markup.button.callback('«', `date_${prevDate}`),
            Markup.button.callback(date, `calendar_${date}`),
            Markup.button.callback('»', `date_${nextDate}`)
        ],
        [Markup.button.callback('Выйти', 'exit')]
    ]);
}

export default function createStage(bot) {
    const calendar = new Calendar(bot, {
        startWeekDay: 1,
        weekDayNames: ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'],
        monthNames: [
            'Январь','Февраль','Март','Апрель','Май','Июнь',
            'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'
        ]
    });

    const ScheduleScene = new Scenes.BaseScene('SCHEDULE');
    
    ScheduleScene.enter(async (ctx) => {
        if (!ctx.session.groupId) {
            await ctx.reply('Ошибка: не удалось определить вашу группу. Попробуйте /start.');
            return ctx.scene.leave();
        }
        const today = new Date().toISOString().slice(0, 10);
        await ctx.reply(`Расписание для вашей группы на ${today}:`, await getKeyboardForDate(ctx.session.groupId, today));
    });

    ScheduleScene.action(/sub_(\d+)/, async (ctx) => {
        const lessonId = ctx.match[1];
        const lesson = await Lesson.findByPk(lessonId, { include: Subject });

        if (!lesson) {
            return ctx.answerCbQuery('Урок не найден!');
        }
        
        let message = `*${lesson.Subject.name}*\n`;
        message += `Время: ${lesson.timestamp}\n`;
        message += `Тип: ${lesson.isPractice ? 'Практика' : 'Лекция'}\n\n`;
        message += `Ссылка на встречу: ${lesson.meetingLink || 'Нет'}\n`;
        message += `Домашнее задание: ${lesson.homework || 'Нет'}\n`;

        await ctx.editMessageText(
            message,
            {
                parse_mode: 'Markdown',
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback('Закрыть', 'exit')]
                ]).reply_markup
            }
        );
    });

    ScheduleScene.action(/date_(\d{4}-\d{2}-\d{2})/, async (ctx) => {
        const date = ctx.match[1];
        const text = `Расписание для вашей группы на ${date}:`;
        const keyboard = await getKeyboardForDate(ctx.session.groupId, date);
        await ctx.editMessageText(text, { reply_markup: keyboard.reply_markup });
    });

    ScheduleScene.action(/calendar_(\d{4}-\d{2}-\d{2})/, async (ctx) => {
        const date = new Date(ctx.match[1]);
        await ctx.editMessageText('Выберите дату:', calendar.getCalendar(date));
    });

    calendar.setDateListener(async (ctx, date) => {
        await ctx.deleteMessage();
        const text = `Расписание для вашей группы на ${date}:`;
        const keyboard = await getKeyboardForDate(ctx.session.groupId, date);
        await ctx.reply(text, keyboard);
    });

    ScheduleScene.action('exit', async (ctx) => {
        await ctx.editMessageText('Меню закрыто.');
        return ctx.scene.leave();
    });

    const GroupSelector = new Scenes.WizardScene(
        'GROUP_SELECTOR',
        async (ctx) => {
            const [user, created] = await User.findOrCreate({
                where: { id: ctx.from.id },
            });
            
            await ctx.reply('Добро пожаловать! Создайте новую группу или присоединитесь к существующей:', Markup.inlineKeyboard([
                [Markup.button.callback('Создать новую', 'new')],
                [Markup.button.callback('Присоединиться', 'join')]
            ]));
            return ctx.wizard.next();
        },
        async (ctx) => {
            if (!ctx.callbackQuery) return;
            ctx.wizard.state.action = ctx.callbackQuery.data;
            if (ctx.wizard.state.action === 'new') {
                await ctx.editMessageText('Введите название для вашей группы:');
            } else if (ctx.wizard.state.action === 'join') {
                await ctx.editMessageText('Введите код приглашения группы:');
            }
            return ctx.wizard.next();
        },
        async (ctx) => {
            if (!ctx.message?.text) return;
            const user = await User.findByPk(ctx.from.id);

            if (ctx.wizard.state.action === 'new') {
                const group = await Group.create({ name: ctx.message.text });
                await user.addGroup(group, { through: { isAdmin: true } });
                
                ctx.session.groupId = group.id;

                await ctx.reply(`Группа "${group.name}" успешно создана! Код для приглашения: \`${group.name}\` (нажмите, чтобы скопировать).`);
                
            } else if (ctx.wizard.state.action === 'join') {
                const inviteCode = ctx.message.text;
                const group = await Group.findOne({ where: { name: inviteCode } });
                
                if (!group) {
                    await ctx.reply('Группа с таким кодом не найдена. Попробуйте еще раз или создайте новую /start.');
                    return ctx.scene.reenter();
                }

                await user.addGroup(group, { through: { isAdmin: false } });
                ctx.session.groupId = group.id;
                await ctx.reply(`Вы успешно присоединились к группе "${group.name}"!`);
            }
            
            return ctx.scene.enter('SCHEDULE');
        }
    );

    return new Scenes.Stage([GroupSelector, ScheduleScene]);
}