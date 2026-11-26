const { getDb } = require('../config/db');

// Helper to get current day of week in IST (Asia/Kolkata)
function getCurrentISTDay() {
  try {
    return new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' });
  } catch (_) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[new Date().getDay()];
  }
}

// Helper to determine active meal based on current IST time
function getActiveISTMeal() {
  const now = new Date();
  const istStr = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const istDate = new Date(istStr);
  const totalMins = istDate.getHours() * 60 + istDate.getMinutes();

  if (totalMins < 630) {
    // Before 10:30 AM
    return { current: 'Breakfast', next: 'Lunch' };
  } else if (totalMins < 930) {
    // 10:30 AM to 3:30 PM
    return { current: 'Lunch', next: 'Dinner' };
  } else {
    // After 3:30 PM
    return { current: 'Dinner', next: 'Breakfast' };
  }
}

/**
 * GET /api/food/weekly
 * Returns complete 7-day weekly menu for residents and public
 */
async function getWeeklyMenu(req, res) {
  try {
    const db = await getDb();
    const { rows: menuItems } = await db.query(`
      SELECT id, dayOfWeek, mealType, items, specialItem, timings, isVegetarian, status, updatedAt
      FROM food_menu
      WHERE status = 'PUBLISHED'
      ORDER BY 
        CASE dayOfWeek
          WHEN 'Monday' THEN 1
          WHEN 'Tuesday' THEN 2
          WHEN 'Wednesday' THEN 3
          WHEN 'Thursday' THEN 4
          WHEN 'Friday' THEN 5
          WHEN 'Saturday' THEN 6
          WHEN 'Sunday' THEN 7
          ELSE 8
        END,
        CASE mealType
          WHEN 'Breakfast' THEN 1
          WHEN 'Lunch' THEN 2
          WHEN 'Snacks' THEN 3
          WHEN 'Dinner' THEN 4
          ELSE 5
        END
    `);

    // Group items by day
    const daysOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const weeklySchedule = {};
    for (const d of daysOrder) {
      weeklySchedule[d] = {
        Breakfast: null,
        Lunch: null,
        Dinner: null
      };
    }

    for (const item of menuItems) {
      if (weeklySchedule[item.dayofweek]) {
        weeklySchedule[item.dayofweek][item.mealtype] = item;
      }
    }

    // Retrieve mess configuration
    const { rows: settingsRows } = await db.query(`
      SELECT key, value FROM hostelSettings 
      WHERE key IN ('messEnabled', 'messIncludedInRent', 'messMonthlyFee', 'breakfastTimings', 'lunchTimings', 'dinnerTimings')
    `);

    const config = {};
    for (const s of settingsRows) {
      config[s.key] = s.value;
    }

    const todayIST = getCurrentISTDay();
    const activeMeal = getActiveISTMeal();

    return res.status(200).json({
      success: true,
      today: todayIST,
      activeMeal,
      weeklySchedule,
      rawList: menuItems,
      config: {
        messEnabled: config.messEnabled !== 'false',
        messIncludedInRent: config.messIncludedInRent !== 'false',
        messMonthlyFee: parseFloat(config.messMonthlyFee || 2500),
        breakfastTimings: config.breakfastTimings || '7:30 AM - 9:30 AM',
        lunchTimings: config.lunchTimings || '12:30 PM - 2:30 PM',
        dinnerTimings: config.dinnerTimings || '7:30 PM - 9:30 PM'
      }
    });
  } catch (err) {
    console.error('Error fetching weekly food menu:', err);
    return res.status(500).json({ success: false, message: `Failed to load menu: ${err.message}` });
  }
}

/**
 * GET /api/food/today
 * Returns today's meals based on IST
 */
async function getTodayMenu(req, res) {
  try {
    const db = await getDb();
    const today = getCurrentISTDay();
    const { rows: meals } = await db.query(
      `SELECT * FROM food_menu 
       WHERE LOWER(dayOfWeek) = LOWER($1) AND status = 'PUBLISHED'
       ORDER BY 
         CASE mealType
           WHEN 'Breakfast' THEN 1
           WHEN 'Lunch' THEN 2
           WHEN 'Snacks' THEN 3
           WHEN 'Dinner' THEN 4
           ELSE 5
         END`,
      [today]
    );

    const activeMeal = getActiveISTMeal();

    return res.status(200).json({
      success: true,
      day: today,
      activeMeal,
      meals
    });
  } catch (err) {
    console.error('Error fetching today food menu:', err);
    return res.status(500).json({ success: false, message: `Failed to load today's menu: ${err.message}` });
  }
}

/**
 * GET /api/food/admin/menu
 * Admin views all menu records including drafts and edit history
 */
async function getAdminWeeklyMenu(req, res) {
  try {
    const db = await getDb();
    const { rows: menuItems } = await db.query(`
      SELECT * FROM food_menu
      ORDER BY 
        CASE dayOfWeek
          WHEN 'Monday' THEN 1
          WHEN 'Tuesday' THEN 2
          WHEN 'Wednesday' THEN 3
          WHEN 'Thursday' THEN 4
          WHEN 'Friday' THEN 5
          WHEN 'Saturday' THEN 6
          WHEN 'Sunday' THEN 7
          ELSE 8
        END,
        CASE mealType
          WHEN 'Breakfast' THEN 1
          WHEN 'Lunch' THEN 2
          WHEN 'Snacks' THEN 3
          WHEN 'Dinner' THEN 4
          ELSE 5
        END
    `);

    return res.status(200).json({
      success: true,
      menu: menuItems
    });
  } catch (err) {
    console.error('Error fetching admin food menu:', err);
    return res.status(500).json({ success: false, message: `Failed to load admin menu: ${err.message}` });
  }
}

/**
 * PUT /api/food/admin/menu
 * Admin updates or creates a specific day and meal menu
 */
async function updateMealMenu(req, res) {
  try {
    const { dayOfWeek, mealType, items, specialItem, timings, isVegetarian, status } = req.body;

    if (!dayOfWeek || !mealType || !items) {
      return res.status(400).json({
        success: false,
        message: 'dayOfWeek, mealType, and items are required fields.'
      });
    }

    const db = await getDb();
    const updaterName = req.user && req.user.name ? req.user.name : 'Hostel Administration';
    const isVeg = isVegetarian === true || isVegetarian === 'true' || isVegetarian === 1;
    const finalStatus = status || 'PUBLISHED';
    const finalTimings = timings || (
      mealType === 'Breakfast' ? '7:30 AM - 9:30 AM' : 
      mealType === 'Lunch' ? '12:30 PM - 2:30 PM' : '7:30 PM - 9:30 PM'
    );

    const { rows } = await db.query(
      `INSERT INTO food_menu (dayOfWeek, mealType, items, specialItem, timings, isVegetarian, status, updatedBy, updatedAt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
       ON CONFLICT (dayOfWeek, mealType) DO UPDATE SET
         items = EXCLUDED.items,
         specialItem = EXCLUDED.specialItem,
         timings = EXCLUDED.timings,
         isVegetarian = EXCLUDED.isVegetarian,
         status = EXCLUDED.status,
         updatedBy = EXCLUDED.updatedBy,
         updatedAt = CURRENT_TIMESTAMP
       RETURNING *`,
      [dayOfWeek, mealType, items.trim(), specialItem ? specialItem.trim() : null, finalTimings, isVeg, finalStatus, updaterName]
    );

    return res.status(200).json({
      success: true,
      message: `${dayOfWeek} ${mealType} menu updated successfully.`,
      meal: rows[0]
    });
  } catch (err) {
    console.error('Error updating meal menu:', err);
    return res.status(500).json({ success: false, message: `Failed to update meal: ${err.message}` });
  }
}

/**
 * POST /api/food/admin/publish-week
 * Admin bulk publishes or updates the entire weekly schedule
 */
async function publishWeeklyMenu(req, res) {
  try {
    const { meals } = req.body;
    if (!meals || !Array.isArray(meals)) {
      return res.status(400).json({ success: false, message: 'meals array is required.' });
    }

    const db = await getDb();
    const updaterName = req.user && req.user.name ? req.user.name : 'Hostel Administration';

    await db.query('BEGIN');
    try {
      for (const meal of meals) {
        if (!meal.dayOfWeek || !meal.mealType || !meal.items) continue;
        const isVeg = meal.isVegetarian === true || meal.isVegetarian === 'true';
        await db.query(
          `INSERT INTO food_menu (dayOfWeek, mealType, items, specialItem, timings, isVegetarian, status, updatedBy, updatedAt)
           VALUES ($1, $2, $3, $4, $5, $6, 'PUBLISHED', $7, CURRENT_TIMESTAMP)
           ON CONFLICT (dayOfWeek, mealType) DO UPDATE SET
             items = EXCLUDED.items,
             specialItem = EXCLUDED.specialItem,
             timings = EXCLUDED.timings,
             isVegetarian = EXCLUDED.isVegetarian,
             status = 'PUBLISHED',
             updatedBy = EXCLUDED.updatedBy,
             updatedAt = CURRENT_TIMESTAMP`,
          [
            meal.dayOfWeek,
            meal.mealType,
            meal.items.trim(),
            meal.specialItem ? meal.specialItem.trim() : null,
            meal.timings || 'Standard',
            isVeg,
            updaterName
          ]
        );
      }
      await db.query('COMMIT');

      return res.status(200).json({
        success: true,
        message: 'Weekly food menu published successfully for all residents.'
      });
    } catch (txErr) {
      await db.query('ROLLBACK');
      throw txErr;
    }
  } catch (err) {
    console.error('Error publishing weekly menu:', err);
    return res.status(500).json({ success: false, message: `Failed to publish menu: ${err.message}` });
  }
}

/**
 * GET /api/food/preferences
 * Student retrieves their dietary preferences & mess subscription
 */
async function getStudentPreferences(req, res) {
  try {
    const db = await getDb();
    const { rows: studentRows } = await db.query(
      `SELECT id, studentName FROM students WHERE userId = $1`,
      [req.user.id]
    );

    if (studentRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    const studentId = studentRows[0].id;
    const { rows: prefRows } = await db.query(
      `SELECT * FROM student_food_preferences WHERE studentId = $1`,
      [studentId]
    );

    const preference = prefRows[0] || {
      studentId,
      dietaryType: 'NON_VEG',
      isMessOpted: true,
      monthlyMessFee: 0,
      allergies: '',
      specialInstructions: ''
    };

    return res.status(200).json({
      success: true,
      preference
    });
  } catch (err) {
    console.error('Error fetching student food preferences:', err);
    return res.status(500).json({ success: false, message: `Failed to fetch preferences: ${err.message}` });
  }
}

/**
 * PUT /api/food/preferences
 * Student updates their dietary preferences & mess subscription
 */
async function updateStudentPreferences(req, res) {
  try {
    const { dietaryType, isMessOpted, allergies, specialInstructions } = req.body;
    const db = await getDb();

    const { rows: studentRows } = await db.query(
      `SELECT id FROM students WHERE userId = $1`,
      [req.user.id]
    );

    if (studentRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    const studentId = studentRows[0].id;
    const validDiet = ['VEG', 'NON_VEG', 'EGGITARIAN'].includes(dietaryType) ? dietaryType : 'NON_VEG';
    const messOpt = isMessOpted !== false && isMessOpted !== 'false';

    const { rows: updatedRows } = await db.query(
      `INSERT INTO student_food_preferences (studentId, dietaryType, isMessOpted, allergies, specialInstructions, updatedAt)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       ON CONFLICT (studentId) DO UPDATE SET
         dietaryType = EXCLUDED.dietaryType,
         isMessOpted = EXCLUDED.isMessOpted,
         allergies = EXCLUDED.allergies,
         specialInstructions = EXCLUDED.specialInstructions,
         updatedAt = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        studentId,
        validDiet,
        messOpt,
        allergies ? allergies.trim() : null,
        specialInstructions ? specialInstructions.trim() : null
      ]
    );

    return res.status(200).json({
      success: true,
      message: 'Dietary preferences and mess options updated successfully.',
      preference: updatedRows[0]
    });
  } catch (err) {
    console.error('Error updating food preferences:', err);
    return res.status(500).json({ success: false, message: `Failed to update preferences: ${err.message}` });
  }
}

/**
 * GET /api/food/admin/preferences
 * Admin views resident dietary summary & mess roster
 */
async function getAdminDietaryRoster(req, res) {
  try {
    const db = await getDb();

    const { rows: roster } = await db.query(`
      SELECT 
        s.id as studentId,
        s.studentName,
        s.studentCustomId,
        s.phone,
        r.roomNumber,
        b.bedLabel,
        COALESCE(fp.dietaryType, 'NON_VEG') as dietaryType,
        COALESCE(fp.isMessOpted, true) as isMessOpted,
        fp.allergies,
        fp.specialInstructions,
        fp.updatedAt as preferenceUpdatedAt
      FROM students s
      LEFT JOIN rooms r ON s.roomId = r.id
      LEFT JOIN beds b ON s.bedId = b.id
      LEFT JOIN student_food_preferences fp ON s.id = fp.studentId
      WHERE s.status = 'active'
      ORDER BY r.roomNumber ASC NULLS LAST, s.studentName ASC
    `);

    // Calculate aggregated metrics
    let totalResidents = roster.length;
    let messOptedCount = 0;
    let vegCount = 0;
    let nonVegCount = 0;
    let eggCount = 0;
    let allergiesCount = 0;

    for (const r of roster) {
      if (r.ismessopted) messOptedCount++;
      const dt = (r.dietarytype || 'NON_VEG').toUpperCase();
      if (dt === 'VEG') vegCount++;
      else if (dt === 'EGGITARIAN') eggCount++;
      else nonVegCount++;

      if (r.allergies && r.allergies.trim()) allergiesCount++;
    }

    return res.status(200).json({
      success: true,
      metrics: {
        totalResidents,
        messOptedCount,
        vegCount,
        nonVegCount,
        eggCount,
        allergiesCount
      },
      roster
    });
  } catch (err) {
    console.error('Error fetching dietary roster:', err);
    return res.status(500).json({ success: false, message: `Failed to load roster: ${err.message}` });
  }
}

/**
 * GET /api/food/admin/complaints
 * Retrieve food and mess specific complaints
 */
async function getFoodComplaints(req, res) {
  try {
    const db = await getDb();
    const { rows: complaints } = await db.query(`
      SELECT c.*, 
             s.studentName, s.phone,
             r.roomNumber, b.bedLabel
      FROM complaints c
      JOIN students s ON c.studentId = s.id
      LEFT JOIN rooms r ON c.roomId = r.id
      LEFT JOIN beds b ON c.bedId = b.id
      WHERE LOWER(c.category) LIKE '%food%' OR LOWER(c.category) LIKE '%mess%' OR LOWER(c.category) LIKE '%dining%'
      ORDER BY c.createdAt DESC
    `);

    return res.status(200).json({
      success: true,
      complaints,
      count: complaints.length
    });
  } catch (err) {
    console.error('Error fetching food complaints:', err);
    return res.status(500).json({ success: false, message: `Failed to load food complaints: ${err.message}` });
  }
}

/**
 * GET /api/food/config
 * Get mess configuration
 */
async function getMessConfig(req, res) {
  try {
    const db = await getDb();
    const { rows } = await db.query(`
      SELECT key, value FROM hostelSettings
      WHERE key IN ('messEnabled', 'messIncludedInRent', 'messMonthlyFee', 'breakfastTimings', 'lunchTimings', 'dinnerTimings')
    `);

    const config = {};
    for (const r of rows) {
      config[r.key] = r.value;
    }

    return res.status(200).json({
      success: true,
      config: {
        messEnabled: config.messEnabled !== 'false',
        messIncludedInRent: config.messIncludedInRent !== 'false',
        messMonthlyFee: parseFloat(config.messMonthlyFee || 2500),
        breakfastTimings: config.breakfastTimings || '7:30 AM - 9:30 AM',
        lunchTimings: config.lunchTimings || '12:30 PM - 2:30 PM',
        dinnerTimings: config.dinnerTimings || '7:30 PM - 9:30 PM'
      }
    });
  } catch (err) {
    console.error('Error fetching mess config:', err);
    return res.status(500).json({ success: false, message: `Failed to load config: ${err.message}` });
  }
}

/**
 * PUT /api/food/admin/config
 * Update mess configuration
 */
async function updateMessConfig(req, res) {
  try {
    const { messEnabled, messIncludedInRent, messMonthlyFee, breakfastTimings, lunchTimings, dinnerTimings } = req.body;
    const db = await getDb();

    const updates = [
      { key: 'messEnabled', value: String(messEnabled !== false) },
      { key: 'messIncludedInRent', value: String(messIncludedInRent !== false) },
      { key: 'messMonthlyFee', value: String(Math.max(0, parseFloat(messMonthlyFee) || 0)) },
      { key: 'breakfastTimings', value: breakfastTimings ? breakfastTimings.trim() : '7:30 AM - 9:30 AM' },
      { key: 'lunchTimings', value: lunchTimings ? lunchTimings.trim() : '12:30 PM - 2:30 PM' },
      { key: 'dinnerTimings', value: dinnerTimings ? dinnerTimings.trim() : '7:30 PM - 9:30 PM' }
    ];

    for (const u of updates) {
      await db.query(
        `INSERT INTO hostelSettings (key, value)
         VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [u.key, u.value]
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Mess configuration updated successfully.'
    });
  } catch (err) {
    console.error('Error updating mess config:', err);
    return res.status(500).json({ success: false, message: `Failed to update config: ${err.message}` });
  }
}

module.exports = {
  getWeeklyMenu,
  getTodayMenu,
  getAdminWeeklyMenu,
  updateMealMenu,
  publishWeeklyMenu,
  getStudentPreferences,
  updateStudentPreferences,
  getAdminDietaryRoster,
  getFoodComplaints,
  getMessConfig,
  updateMessConfig
};
