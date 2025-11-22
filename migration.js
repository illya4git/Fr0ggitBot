import { Sequelize, DataTypes } from 'sequelize';

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: './data/main.sqlite',
  logging: false
});

(async function run() {
  const qi = sequelize.getQueryInterface();
  try {
    console.log('Backup main.sqlite before running this script!');
    const info = await sequelize.query("PRAGMA table_info('Groups');", { type: sequelize.QueryTypes.SELECT }).catch(()=>null);
    const exists = info && info.some(r => r.name === 'deadlineList');
    if (exists) {
      console.log('Column Groups.deadlineList already exists — nothing to do.');
      return;
    }
    console.log('Adding column Groups.deadlineList...');
    await qi.addColumn('Groups', 'deadlineList', {
      type: DataTypes.TEXT,
      allowNull: true
    });
    console.log('OK — added Groups.deadlineList');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();