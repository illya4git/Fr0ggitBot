import { Group, Subject, Lesson, sequelize } from './Models.js';

async function fillScheduleFromApi(groupName = "ІП-56") {
    // список групп
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

    // расписание
    const lessonsRes = await fetch(`https://api.campus.kpi.ua/schedule/lessons?groupId=${groupData.id}`);
    const scheduleObj = await lessonsRes.json();

    async function processWeek(weekArr, weekType) {
        for (const dayObj of weekArr) {
            for (const pair of dayObj.pairs) {
                // Создаём или находим предмет
                let [subject] = await Subject.findOrCreate({
                    where: { name: pair.name },
                    defaults: { GroupId: group.id }
                });

                // Добавляем занятие
                await Lesson.create({
                    timestamp: pair.time, 
                    isPractice: pair.type === 'Прак',
                    meetingLink: pair.meetingLink || null,
                    recordingLink: pair.recordingLink || null,
                    homework: pair.homework || null,
                    GroupId: group.id,
                    SubjectId: subject.id,
                    day: dayObj.day,         // День недели 
                    weekType: weekType       // Тип недели 
                });
            }
        }
    }

    await processWeek(scheduleObj.scheduleFirstWeek, 'first');
    await processWeek(scheduleObj.scheduleSecondWeek, 'second');

    console.log('База данных заполнена!');
}

await sequelize.sync();
await fillScheduleFromApi();