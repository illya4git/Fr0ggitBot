import { Group, Subject, Lesson, sequelize } from './Models.js';

async function fillScheduleFromApi(groupName = "ІП-56", defaultLabLinks = ['https://example.com/queue.xlsx']) {
    const res = await fetch("https://api.campus.kpi.ua/group/all");
    const groups = await res.json();
    const groupData = groups.find(g => g.name === groupName);
    if (!groupData) {
        console.log('Группа не найдена');
        return;
    }

    let [group] = await Group.findOrCreate({
        where: { name: groupData.name }
    });

    try {
        const hasLinks = group.labLinks && group.labLinks.trim().length > 0;
        if (!hasLinks) {
            group.labLinks = JSON.stringify(defaultLabLinks);
            await group.save();
            console.log('Добавлена дефолтная черга на лабу для группы:', group.name);
        }
    } catch (e) {
        console.error('Ошибка при установке дефолтной черги:', e);
    }


    const lessonsRes = await fetch(`https://api.campus.kpi.ua/schedule/lessons?groupId=${groupData.id}`);
    const scheduleObj = await lessonsRes.json();

    async function processWeek(weekArr, weekType, t) {
        for (const dayObj of weekArr) {
            const dayName = dayObj.day; 
            for (const pair of dayObj.pairs) {
                const time = pair.time ? String(pair.time).trim() : null;
                const subjName = pair.name ? String(pair.name).trim() : 'Не вказано';

                const [subject] = await Subject.findOrCreate({
                    where: { name: subjName, GroupId: group.id },
                    defaults: { GroupId: group.id },
                    transaction: t
                });

            
                const [lesson, created] = await Lesson.findOrCreate({
                    where: {
                        GroupId: group.id,
                        SubjectId: subject.id,
                        day: dayName,
                        timestamp: time,
                        weekType: weekType
                    },
                    defaults: {
                        timestamp: time,
                        isPractice: pair.type === 'Прак',
                        meetingLink: pair.meetingLink || null,
                        recordingLink: pair.recordingLink || null,
                        homework: pair.homework || null,
                        GroupId: group.id,
                        SubjectId: subject.id,
                        day: dayName,
                        weekType: weekType
                    },
                    transaction: t
                });

            
                if (!created) {
                    let changed = false;
                    if (pair.meetingLink && lesson.meetingLink !== pair.meetingLink) { lesson.meetingLink = pair.meetingLink; changed = true; }
                    if (pair.recordingLink && lesson.recordingLink !== pair.recordingLink) { lesson.recordingLink = pair.recordingLink; changed = true; }
                    if (pair.homework && lesson.homework !== pair.homework) { lesson.homework = pair.homework; changed = true; }
                    if (changed) await lesson.save({ transaction: t });
                }
            }
        }
    }

    await sequelize.transaction(async (t) => {
        await processWeek(scheduleObj.scheduleFirstWeek || [], 'first', t);
        await processWeek(scheduleObj.scheduleSecondWeek || [], 'second', t);
    });

    console.log('База данных заполнена!');
}

await sequelize.sync();
await fillScheduleFromApi();