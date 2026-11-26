require('dotenv').config();
const { getDb } = require('../config/db');
const foodController = require('../controllers/foodController');
const complaintController = require('../controllers/complaintController');

async function runPhase9Tests() {
  console.log('====================================================');
  console.log('STARTING PHASE 9 FOOD & MESS MANAGEMENT TEST SUITE');
  console.log('====================================================');

  const db = await getDb();
  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (!condition) {
      console.error(`❌ FAIL: ${message}`);
      throw new Error(message);
    } else {
      passedTests++;
      console.log(`✅ PASS: ${message}`);
    }
  }

  try {
    // 1. Verify database schema for food_menu and student_food_preferences
    console.log('\n--- Test 1: Verify Database Schema ---');
    const { rows: menuCols } = await db.query(`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'food_menu'
    `);
    const menuColNames = menuCols.map(c => c.column_name.toLowerCase());
    const requiredMenuCols = ['id', 'dayofweek', 'mealtype', 'items', 'specialitem', 'timings', 'isvegetarian', 'status'];
    for (const c of requiredMenuCols) {
      assert(menuColNames.includes(c), `Column '${c}' exists in 'food_menu' table`);
    }

    const { rows: prefCols } = await db.query(`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'student_food_preferences'
    `);
    const prefColNames = prefCols.map(c => c.column_name.toLowerCase());
    const requiredPrefCols = ['id', 'studentid', 'dietarytype', 'ismessopted', 'allergies', 'specialinstructions'];
    for (const c of requiredPrefCols) {
      assert(prefColNames.includes(c), `Column '${c}' exists in 'student_food_preferences' table`);
    }

    // 2. Verify 7-day default weekly menu is populated
    console.log('\n--- Test 2: Verify Default 7-Day Food Menu Seeded ---');
    const { rows: allMeals } = await db.query(`SELECT COUNT(*)::int as count FROM food_menu`);
    assert(allMeals[0].count >= 21, `Food menu contains standard 21 meals across 7 days (Count: ${allMeals[0].count})`);

    // 3. Test GET /api/food/weekly
    console.log('\n--- Test 3: Retrieve Complete Weekly Food Menu ---');
    const mockReqWeekly = {};
    const mockResWeekly = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.responseData = data; return this; }
    };
    await foodController.getWeeklyMenu(mockReqWeekly, mockResWeekly);
    assert(mockResWeekly.statusCode === 200, 'getWeeklyMenu returns 200 OK');
    assert(mockResWeekly.responseData.success === true, 'Response indicates success: true');
    assert(!!mockResWeekly.responseData.today, `Current day reported: ${mockResWeekly.responseData.today}`);
    assert(!!mockResWeekly.responseData.activeMeal, `Current active meal reported: ${mockResWeekly.responseData.activeMeal.current}`);
    assert(!!mockResWeekly.responseData.weeklySchedule['Monday'], 'Monday schedule present in response');
    assert(!!mockResWeekly.responseData.config, 'Mess configuration included in weekly response');

    // 4. Test GET /api/food/today
    console.log('\n--- Test 4: Retrieve Today Live Food Menu ---');
    const mockReqToday = {};
    const mockResToday = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.responseData = data; return this; }
    };
    await foodController.getTodayMenu(mockReqToday, mockResToday);
    assert(mockResToday.statusCode === 200, 'getTodayMenu returns 200 OK');
    assert(Array.isArray(mockResToday.responseData.meals), 'Meals returned as array');
    assert(mockResToday.responseData.meals.length >= 3, 'Today contains Breakfast, Lunch, and Dinner');

    // 5. Test Admin Menu Creation and Publishing
    console.log('\n--- Test 5: Admin Updates Specific Day Meal ---');
    const mockReqUpdateMeal = {
      user: { name: 'Admin Joel' },
      body: {
        dayOfWeek: 'Friday',
        mealType: 'Lunch',
        items: 'Steamed Basmati Rice, Hyderabadi Pappu Charu, Crispy Aratikaya Vepudu, Curd & Papad',
        specialItem: 'Crispy Aratikaya Vepudu Special',
        timings: '12:30 PM - 2:30 PM',
        isVegetarian: true,
        status: 'PUBLISHED'
      }
    };
    const mockResUpdateMeal = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.responseData = data; return this; }
    };
    await foodController.updateMealMenu(mockReqUpdateMeal, mockResUpdateMeal);
    assert(mockResUpdateMeal.statusCode === 200, 'Admin updateMealMenu returns 200 OK');
    assert(mockResUpdateMeal.responseData.meal.specialitem === 'Crispy Aratikaya Vepudu Special', 'Special item saved');

    // 6. Test Admin Bulk Week Publishing
    console.log('\n--- Test 6: Admin Bulk Publishes Entire Week ---');
    const sampleMeals = [
      { dayOfWeek: 'Monday', mealType: 'Breakfast', items: 'Idli & Vada with Chutney', specialItem: null, timings: '7:30 AM - 9:30 AM', isVegetarian: true },
      { dayOfWeek: 'Sunday', mealType: 'Lunch', items: 'Hyderabadi Chicken Dum Biryani / Paneer Biryani', specialItem: 'Sunday Biryani Feast', timings: '12:30 PM - 2:30 PM', isVegetarian: false }
    ];
    const mockReqPublishWeek = {
      user: { name: 'Admin Joel' },
      body: { meals: sampleMeals }
    };
    const mockResPublishWeek = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.responseData = data; return this; }
    };
    await foodController.publishWeeklyMenu(mockReqPublishWeek, mockResPublishWeek);
    assert(mockResPublishWeek.statusCode === 200, 'publishWeeklyMenu returns 200 OK');

    // 7. Test Student Food Preferences & Mess Opt-In
    console.log('\n--- Test 7: Student Updates Dietary Preferences & Allergies ---');
    const { rows: testStudents } = await db.query(`
      SELECT s.id, s.userId FROM students s
      JOIN users u ON s.userId = u.id
      WHERE s.status = 'active' LIMIT 1
    `);
    const student = testStudents[0];
    assert(!!student, `Found active resident (Student ID: ${student.id})`);

    const mockReqPref = {
      user: { id: student.userid, role: 'student' },
      body: {
        dietaryType: 'VEG',
        isMessOpted: true,
        allergies: 'Peanut allergy, Low spice',
        specialInstructions: 'Prefer less oily dal and no chilies in curd.'
      }
    };
    const mockResPref = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.responseData = data; return this; }
    };
    await foodController.updateStudentPreferences(mockReqPref, mockResPref);
    assert(mockResPref.statusCode === 200, 'updateStudentPreferences returns 200 OK');
    assert(mockResPref.responseData.preference.dietarytype === 'VEG', 'Dietary type saved as VEG');
    assert(mockResPref.responseData.preference.allergies.includes('Peanut allergy'), 'Allergies recorded');

    // Test GET preferences
    const mockReqGetPref = { user: { id: student.userid, role: 'student' } };
    const mockResGetPref = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.responseData = data; return this; }
    };
    await foodController.getStudentPreferences(mockReqGetPref, mockResGetPref);
    assert(mockResGetPref.statusCode === 200, 'getStudentPreferences returns 200 OK');
    assert(mockResGetPref.responseData.preference.dietarytype === 'VEG', 'Retrieved preferences match updated value');

    // 8. Test Admin Dietary Roster & Metrics
    console.log('\n--- Test 8: Admin Inspects Dietary Roster ---');
    const mockReqRoster = { user: { role: 'admin' } };
    const mockResRoster = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.responseData = data; return this; }
    };
    await foodController.getAdminDietaryRoster(mockReqRoster, mockResRoster);
    assert(mockResRoster.statusCode === 200, 'getAdminDietaryRoster returns 200 OK');
    assert(mockResRoster.responseData.metrics.totalResidents > 0, 'Total residents > 0');
    assert(mockResRoster.responseData.metrics.vegCount > 0, 'Veg residents count > 0');
    assert(Array.isArray(mockResRoster.responseData.roster), 'Roster returned as array');

    // 9. Test Mess Configuration (Configurable mess fee & not assuming included in rent)
    console.log('\n--- Test 9: Configure Mess Settings & Fees ---');
    const mockReqConfig = {
      body: {
        messEnabled: true,
        messIncludedInRent: false,
        messMonthlyFee: 2800,
        breakfastTimings: '7:00 AM - 9:30 AM',
        lunchTimings: '12:30 PM - 2:30 PM',
        dinnerTimings: '7:30 PM - 9:30 PM'
      }
    };
    const mockResConfig = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.responseData = data; return this; }
    };
    await foodController.updateMessConfig(mockReqConfig, mockResConfig);
    assert(mockResConfig.statusCode === 200, 'updateMessConfig returns 200 OK');

    const mockReqGetConfig = {};
    const mockResGetConfig = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.responseData = data; return this; }
    };
    await foodController.getMessConfig(mockReqGetConfig, mockResGetConfig);
    assert(mockResGetConfig.statusCode === 200, 'getMessConfig returns 200 OK');
    assert(mockResGetConfig.responseData.config.messIncludedInRent === false, 'Mess configurable as NOT included in rent');
    assert(mockResGetConfig.responseData.config.messMonthlyFee === 2800, 'Monthly mess fee configured as ₹2,800');

    // Restore to included
    await foodController.updateMessConfig({
      body: {
        messEnabled: true,
        messIncludedInRent: true,
        messMonthlyFee: 2500,
        breakfastTimings: '7:30 AM - 9:30 AM',
        lunchTimings: '12:30 PM - 2:30 PM',
        dinnerTimings: '7:30 PM - 9:30 PM'
      }
    }, { status() { return this; }, json() { return this; } });

    // 10. Test Food-Related Complaints
    console.log('\n--- Test 10: Food-Related Complaints Integration ---');
    const mockReqFoodComp = {
      user: { id: student.userid, role: 'student' },
      body: {
        category: 'Food & Dining',
        title: 'Dining Hall Rice Was Served Cold',
        description: 'During yesterday dinner, the steamed rice and dal were cold by 8:30 PM.',
        priority: 'Medium'
      },
      file: null
    };
    const mockResFoodComp = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.responseData = data; return this; }
    };
    await complaintController.submitComplaint(mockReqFoodComp, mockResFoodComp);
    assert(mockResFoodComp.statusCode === 201, 'Food complaint submitted via complaints engine');
    const foodTicket = mockResFoodComp.responseData.complaint;

    // Check food complaints query
    const mockReqGetFoodComps = {};
    const mockResGetFoodComps = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.responseData = data; return this; }
    };
    await foodController.getFoodComplaints(mockReqGetFoodComps, mockResGetFoodComps);
    assert(mockResGetFoodComps.statusCode === 200, 'getFoodComplaints returns 200 OK');
    assert(mockResGetFoodComps.responseData.complaints.some(c => c.id === foodTicket.id), 'Submitted food ticket appears in food complaints query');

    // Clean up test complaint
    await db.query(`DELETE FROM complaints WHERE id = $1`, [foodTicket.id]);

    console.log('====================================================');
    console.log(`ALL PHASE 9 TESTS PASSED SUCCESSFULLY! (${passedTests}/${totalTests})`);
    console.log('====================================================');
    process.exit(0);
  } catch (err) {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  }
}

runPhase9Tests();
