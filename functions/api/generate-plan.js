// Cloudflare Pages Function: /api/generate-plan
// Lives at: functions/api/generate-plan.js
// Generates a personalized 7-day BCNP meal plan via Claude.

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  try {
    const apiKey = env.CLAUDE_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'API key not configured' }),
        { status: 500, headers: corsHeaders }
      );
    }

    const body = await request.json();
    const { patientProfile } = body;

    if (!patientProfile) {
      return new Response(
        JSON.stringify({ error: 'Missing patient profile' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const lang = patientProfile.language || 'ar';
    const prompt = buildPlanPrompt(patientProfile, lang);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4096,
        system: getSystemPrompt(lang),
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error:', errorText);
      return new Response(
        JSON.stringify({ error: 'AI service unavailable', details: errorText }),
        { status: response.status, headers: corsHeaders }
      );
    }

    const data = await response.json();
    const aiText = data.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    const planData = extractJSON(aiText);
    if (!planData) {
      console.error('Failed to parse JSON from AI response:', aiText.substring(0, 500));
      return new Response(
        JSON.stringify({ error: 'Plan parsing failed', raw: aiText.substring(0, 1000) }),
        { status: 500, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({ plan: planData, usage: data.usage }),
      { status: 200, headers: corsHeaders }
    );

  } catch (error) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: error.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }
  });
}

function getSystemPrompt(lang) {
  const isAr = lang === 'ar';
  return `You are Dr. Sameh Mesallum's clinical AI assistant generating a personalized 7-day BCNP-aligned meal plan.

You MUST respond with ONLY valid JSON in this exact structure (no markdown, no commentary, no preamble):

{
  "summary": "2-3 sentences summarizing what this plan emphasizes for THIS patient and why",
  "calorieTarget": <integer>,
  "macros": { "protein_g": <int>, "carbs_g": <int>, "fat_g": <int> },
  "eatingWindow": "${isAr ? 'e.g. نافذة طعام 10 ساعات (8 ص – 6 م)' : 'e.g. 10-hour eating window (8am-6pm)'}",
  "keyPrinciples": ["principle 1", "principle 2", "principle 3"],
  "days": [
    {
      "name": "${isAr ? 'السبت' : 'Saturday'}",
      "theme": "short theme tying to a BCNP pillar",
      "times": { "breakfast": "8:00", "lunch": "12:30", "snack": "15:30", "dinner": "18:00" },
      "breakfast": "specific meal with grams/portions",
      "lunch": "specific meal with grams/portions (largest meal)",
      "snack": "specific snack with portions",
      "dinner": "specific lighter meal",
      "rationale": "1 sentence explaining why this day is structured this way"
    }
    // ... 7 days total: ${isAr ? 'السبت، الأحد، الاثنين، الثلاثاء، الأربعاء، الخميس، الجمعة' : 'Saturday, Sunday, Monday, Tuesday, Wednesday, Thursday, Friday'}
  ],
  "supplements": ["supplement 1 with rationale", "supplement 2 with rationale"],
  "monitoring": ["lab/measurement to follow up", "..."],
  "warnings": ["specific warning relevant to this patient"],
  "disclaimer": "${isAr ? '⚠️ تنبيه مهم: هذه التوصيات للاسترشاد العام فقط ولا تُعتبر وصفة طبية. يُرجى مراجعة طبيبك الخاص أو د. سامح مسلم شخصياً للحصول على وصفة غذائية حقيقية مناسبة لحالتك.' : '⚠️ IMPORTANT NOTICE: These recommendations are for general guidance only and do NOT constitute a medical prescription. Please consult your healthcare provider or Dr. Sameh Mesallum personally for an actual prescribed diet plan suitable for your condition.'}"
}

═══ BCNP PILLARS YOU APPLY ═══

1. CHRONO-GENOMICS: 10-12hr eating window. Largest meal before 3pm. Protein-forward breakfast. No food within 3hrs of sleep. Caffeine cutoff ~2pm. NO time-restriction in pregnancy.

2. PHYTOCHEMICAL/EPIGENETIC: 30+ different plants/week. Crucifers daily (broccoli, kale, cabbage). Berries 4+/week. Cooked tomato. EVOO daily. Green tea 2-3 cups.

3. MICROBIOME: Prebiotic fiber daily (onions, garlic, leeks, oats, green bananas, cooked-cooled potatoes). Fermented foods if tolerated. Avoid emulsifiers and artificial sweeteners.

4. METABOLIC FLEXIBILITY: 25-40g protein per meal × 3 meals. No grazing. Resistance training 2-4×/week.

5. INFLAMMATION RESOLUTION: Fatty fish (salmon, sardines, mackerel) 2-3×/week. Reduce industrial seed oils. EVOO and avocado oil.

═══ CRITICAL RULES ═══

• Calculate calorieTarget using Mifflin-St Jeor: men: 10×kg + 6.25×cm - 5×age + 5; women: 10×kg + 6.25×cm - 5×age - 161. Multiply by activity factor (sedentary 1.2, light 1.375, moderate 1.55, active 1.725, very_active 1.9). Adjust -500 for weight loss, +400 for weight gain.

• ABSOLUTELY substitute for ALL allergies. If patient is allergic to gluten, NO wheat/barley/rye anywhere in 7 days. If allergic to dairy, NO yogurt/cheese/milk. If allergic to fish, replace with chicken/legumes.

• If patient has DIABETES: low glycemic load, halve bread portions, distribute carbs evenly, emphasize Pillar 1 timing strongly.

• If patient has HYPERTENSION: low sodium, DASH-style, emphasize potassium-rich vegetables.

• If patient has KIDNEY DISEASE: limit protein to ~0.8g/kg unless on dialysis, watch potassium (avoid bananas, oranges, tomato sauce, potatoes), watch phosphorus. Add explicit warning to consult nephrologist.

• If patient is PREGNANT/BREASTFEEDING: NO time-restricted eating. Avoid raw fish, unpasteurized cheese, deli meats. Emphasize folate, iron, omega-3 from low-mercury fish only. eatingWindow should describe even spacing.

• If patient on INSULIN or SULFONYLUREAS: add warning about hypoglycemia risk with timing changes; recommend coordinating with prescribing physician.

• If patient on ANTICOAGULANTS (warfarin, apixaban): warn about high-dose omega-3 supplements; recommend physician coordination.

• Reference patient's actual labs when relevant (e.g., "Given HbA1c of 8.2%...", "Your LDL of X warrants extra emphasis on Pillar 5...").

• Vary meals across all 7 days. Do not repeat the same breakfast or lunch twice.

• Use foods commonly available in Middle Eastern markets (foul medames, labneh, tahini, olives, dates) but with BCNP rigor.

• ${isAr ? 'استخدم اللغة العربية لكل الحقول النصية، مع الاحتفاظ بأسماء العناصر العلمية بالإنجليزية بين قوسين عند الحاجة.' : 'Use English for all text fields. Keep medical terminology accessible.'}

OUTPUT ONLY THE JSON. No code fences. No explanation. No markdown. JUST the JSON object.`;
}

function buildPlanPrompt(p, lang) {
  return `Generate a personalized 7-day BCNP meal plan for this patient.

PATIENT PROFILE:
- Name: ${p.name || 'patient'}
- Age: ${p.age || 'unknown'}
- Gender: ${p.gender || 'unknown'}
- Weight: ${p.weight || 'unknown'} kg
- Height: ${p.height || 'unknown'} cm
- BMI: ${p.bmi || 'unknown'}
- Activity level: ${p.activityLevel || 'unknown'}

MEDICAL CONDITIONS: ${p.conditions?.length ? p.conditions.join(', ') : 'none reported'}

MEDICATIONS: ${p.medications?.length ? p.medications.join(', ') : 'none reported'}

ALLERGIES/INTOLERANCES: ${p.allergies?.length ? p.allergies.join(', ') : 'none reported'}

LABS:
- Fasting glucose: ${p.labs?.glucose || 'not provided'}
- HbA1c: ${p.labs?.hba1c || 'not provided'}%
- Total cholesterol: ${p.labs?.cholesterol || 'not provided'}
- LDL: ${p.labs?.ldl || 'not provided'}
- HDL: ${p.labs?.hdl || 'not provided'}
- Triglycerides: ${p.labs?.triglycerides || 'not provided'}
- Creatinine: ${p.labs?.creatinine || 'not provided'}

VITALS:
- Blood pressure: ${p.vitals?.bp || 'not provided'}

LIFESTYLE:
- Sleep: ${p.lifestyle?.sleep || 'not provided'}
- Stress: ${p.lifestyle?.stress || 'not provided'}
- Smoking: ${p.lifestyle?.smoking || 'not provided'}
- Water: ${p.lifestyle?.water || 'not provided'}

GOALS: ${p.goals?.length ? p.goals.join(', ') : 'general health'}
PREFERRED DIET: ${p.dietType || 'standard'}

Apply ALL 5 BCNP pillars. Address this patient's specific conditions, medications, and labs. Respond with ONLY valid JSON in the exact structure specified — no markdown fences, no commentary.`;
}

function extractJSON(text) {
  if (!text) return null;
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.substring(start, end + 1));
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}
