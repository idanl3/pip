# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: onboarding.spec.js >> every page loads without a script error
- Location: tests\onboarding.spec.js:154:1

# Error details

```
Error: /index.html logged errors

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "console: The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.",
+ ]
```

# Test source

```ts
  61  |     { name: 'Alef', age: '9', trait: 'Sensitive — feels things deeply' },
  62  |     { name: 'Bet', age: '7', trait: 'Strong sense of fairness, notices anything uneven' },
  63  |     { name: 'Gimel', age: '5', trait: 'Easily overwhelmed by noise and commotion' },
  64  |   ];
  65  | 
  66  |   for (const [index, kid] of kids.entries()) {
  67  |     const block = children.nth(index);
  68  |     await block.locator('.js-name').fill(kid.name);
  69  |     await block.locator('.js-age').fill(kid.age);
  70  |     await block.locator('.js-personality-chips .chip', { hasText: kid.trait }).click();
  71  |     await block
  72  |       .locator('.js-conflict-chips .chip', { hasText: 'Gives in quickly to keep the peace' })
  73  |       .click();
  74  |   }
  75  | 
  76  |   // The heading should follow the name as it is typed.
  77  |   await expect(children.nth(0).locator('.child__number')).toHaveText('Alef');
  78  | 
  79  |   await page.locator('#recurring-chips .chip', { hasText: 'Bedtime' }).click();
  80  |   await page.locator('#rules-chips .chip', { hasText: 'No hitting' }).click();
  81  |   await page.fill('#extra-care', 'A new baby arrived recently.');
  82  | 
  83  |   await page.click('#submit');
  84  |   await page.waitForURL('**/home.html');
  85  | 
  86  |   await expect(page.locator('#status-title')).toHaveText(/waiting to be approved/i);
  87  |   await expect(page.locator('#family')).toContainText('Alef, 9');
  88  |   await expect(page.locator('#family')).toContainText('Gimel, 5');
  89  |   await expect(page.locator('#family')).toContainText('Dad and Ima');
  90  | 
  91  |   // Nothing may be startable before approval.
  92  |   await expect(page.locator('#start-card')).toBeHidden();
  93  | 
  94  |   // And the database should agree with the screen.
  95  |   const rows = await sql(`
  96  |     select f.status, f.parent_names::text as parents, count(c.id)::int as kids
  97  |       from public.families f
  98  |       join auth.users u on u.id = f.owner_id
  99  |       left join public.children c on c.family_id = f.id
  100 |      where u.email = '${email}'
  101 |      group by f.status, f.parent_names
  102 |   `);
  103 |   expect(rows[0].status).toBe('pending');
  104 |   expect(rows[0].kids).toBe(3);
  105 |   expect(rows[0].parents).toContain('Ima');
  106 | 
  107 |   expect(errors).toEqual([]);
  108 | });
  109 | 
  110 | test('the saved profile comes back intact when reopened', async ({ page }) => {
  111 |   const errors = watchForErrors(page);
  112 |   const code = await createInvite();
  113 |   const email = testEmail();
  114 | 
  115 |   await page.goto(`/join.html?code=${code}`);
  116 |   await page.fill('#email', email);
  117 |   await page.fill('#password', TEST_PASSWORD);
  118 |   await page.click('#submit');
  119 |   await page.waitForURL('**/onboarding.html');
  120 | 
  121 |   const children = page.locator('#children > .child');
  122 |   await children.nth(1).locator('.js-remove').click();
  123 | 
  124 |   const block = children.nth(0);
  125 |   await block.locator('.js-name').fill('Dalet');
  126 |   await block.locator('.js-age').fill('8');
  127 | 
  128 |   // A suggestion containing a comma, plus words of their own. These share one
  129 |   // database column, and the round trip is the thing being tested: splitting
  130 |   // on commas instead of semicolons would tear the suggestion in half.
  131 |   const commaTrait = 'Shy with new people, slow to warm up';
  132 |   await block.locator('.js-personality-chips .chip', { hasText: commaTrait }).click();
  133 |   await block.locator('.js-personality-other').fill('Loves drawing');
  134 | 
  135 |   await page.locator('#parent-chips .chip', { hasText: 'Mum' }).click();
  136 |   await page.click('#submit');
  137 |   await page.waitForURL('**/home.html');
  138 | 
  139 |   await page.goto('/onboarding.html');
  140 |   const reopened = page.locator('#children > .child').nth(0);
  141 |   await expect(reopened.locator('.js-name')).toHaveValue('Dalet');
  142 |   await expect(reopened.locator('.js-age')).toHaveValue('8');
  143 | 
  144 |   // The chip is ticked again, intact, and the typed words are back in the box
  145 |   // rather than merged into the chips.
  146 |   await expect(
  147 |     reopened.locator('.js-personality-chips input:checked'),
  148 |   ).toHaveValue(commaTrait);
  149 |   await expect(reopened.locator('.js-personality-other')).toHaveValue('Loves drawing');
  150 | 
  151 |   expect(errors).toEqual([]);
  152 | });
  153 | 
  154 | test('every page loads without a script error', async ({ page }) => {
  155 |   // The cheapest possible guard against the dead-deploy failure: a page whose
  156 |   // module throws on load still serves its markup and still returns 200.
  157 |   for (const path of ['/index.html', '/join.html', '/404.html']) {
  158 |     const errors = watchForErrors(page);
  159 |     await page.goto(path);
  160 |     await page.waitForLoadState('networkidle');
> 161 |     expect(errors, `${path} logged errors`).toEqual([]);
      |                                             ^ Error: /index.html logged errors
  162 |   }
  163 | });
  164 | 
  165 | test('an invitation code only works once', async ({ page }) => {
  166 |   const code = await createInvite();
  167 | 
  168 |   await page.goto(`/join.html?code=${code}`);
  169 |   await page.fill('#email', testEmail());
  170 |   await page.fill('#password', TEST_PASSWORD);
  171 |   await page.click('#submit');
  172 |   await page.waitForURL('**/onboarding.html');
  173 | 
  174 |   // A second family trying the same link gets refused, and is told the code is
  175 |   // the problem rather than their account.
  176 |   await page.goto('/index.html');
  177 |   await page.evaluate(() => localStorage.clear());
  178 | 
  179 |   await page.goto(`/join.html?code=${code}`);
  180 |   await page.fill('#email', testEmail());
  181 |   await page.fill('#password', TEST_PASSWORD);
  182 |   await page.click('#submit');
  183 | 
  184 |   await expect(page.locator('#notice')).toContainText(/did not work/i);
  185 |   await expect(page.locator('#code-field')).toBeVisible();
  186 | });
  187 | 
```