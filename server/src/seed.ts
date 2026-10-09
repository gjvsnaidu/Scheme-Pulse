import bcrypt from 'bcryptjs';
import type { Db } from './db';
import type { Config } from './config';
import { saveScheme, type SchemeInput } from './services/schemes';

const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const R = (field: any, op: any, value: any, label: string) => ({ field, op, value, label });

/** Illustrative demo records. NOT official government data; every row is flagged is_demo. */
export const DEMO_SCHEMES = (): SchemeInput[] => [
  { slug: 'national-merit-scholarship', name: 'National Merit Scholarship for Higher Education', department: 'Dept. of Higher Education', category: 'Education', summary: 'Annual scholarship for students in degree programmes from low-income families.', benefitText: 'Up to ₹50,000 a year', benefitValue: 50000, goal: 'education', deadline: day(54), isDemo: true,
    rules: [R('age', 'between', [17, 30], 'Age'), R('income', 'lte', 300000, 'Family income'), R('occupation', 'in', ['student'], 'Who it is for')], documents: ['Aadhaar', 'Income certificate', 'Student ID', 'Bank passbook'] },
  { slug: 'fee-reimbursement-professional-courses', name: 'Fee Reimbursement for Professional Courses', department: 'State Higher Education Council', category: 'Education', level: 'state', states: ['Andhra Pradesh', 'Telangana'], summary: 'Tuition fee reimbursement for engineering, medical and other professional courses.', benefitText: 'Tuition fees reimbursed (about ₹90,000)', benefitValue: 90000, goal: 'education', deadline: day(14), isDemo: true,
    rules: [R('age', 'between', [17, 28], 'Age'), R('income', 'lte', 350000, 'Family income'), R('state', 'in', ['Andhra Pradesh', 'Telangana'], 'Location'), R('occupation', 'in', ['student'], 'Who it is for')], documents: ['Aadhaar', 'Income certificate', 'Residence certificate', 'Student ID'] },
  { slug: 'education-loan-interest-subsidy', name: 'Education Loan Interest Subsidy', department: 'Dept. of Financial Services', category: 'Education', summary: 'Interest on education loans is paid by the government during the course period.', benefitText: 'Interest paid during your course', benefitValue: 40000, goal: 'education', deadline: day(175), isDemo: true,
    rules: [R('age', 'between', [17, 35], 'Age'), R('income', 'lte', 450000, 'Family income'), R('occupation', 'in', ['student'], 'Who it is for')], documents: ['Aadhaar', 'Income certificate', 'Student ID', 'Bank passbook'] },
  { slug: 'kisan-income-support', name: 'Kisan Income Support Programme', department: 'Dept. of Agriculture', category: 'Agriculture', summary: 'Direct income support for cultivating farmer families.', benefitText: '₹6,000 a year in your bank account', benefitValue: 6000, goal: 'agriculture', deadline: day(116), isDemo: true,
    rules: [R('age', 'between', [18, 99], 'Age'), R('occupation', 'in', ['farmer'], 'Who it is for')], documents: ['Aadhaar', 'Land record', 'Bank passbook'] },
  { slug: 'micro-enterprise-credit', name: 'Micro-Enterprise Credit Programme', department: 'Ministry of MSME', category: 'Business', summary: 'Collateral-free credit for small and micro businesses.', benefitText: 'Collateral-free loan up to ₹10 lakh', benefitValue: 1000000, goal: 'business', deadline: day(175), isDemo: true,
    rules: [R('age', 'between', [18, 50], 'Age'), R('income', 'lte', 800000, 'Family income'), R('occupation', 'in', ['entrepreneur', 'jobseeker'], 'Who it is for')], documents: ['Aadhaar', 'Business plan', 'Bank passbook'] },
  { slug: 'founders-seed-grant', name: 'Seed Grant for First-time Founders', department: 'Startup Mission', category: 'Business', summary: 'One-time grant for first-time founders to build a prototype.', benefitText: 'Grant up to ₹5 lakh', benefitValue: 500000, goal: 'business', deadline: day(69), isDemo: true,
    rules: [R('age', 'between', [18, 40], 'Age'), R('occupation', 'in', ['entrepreneur', 'student', 'jobseeker'], 'Who it is for')], documents: ['Aadhaar', 'Business plan', 'Bank passbook'] },
  { slug: 'youth-skill-stipend', name: 'Youth Skill Training Stipend', department: 'Dept. of Skill Development', category: 'Skill Development', summary: 'Monthly stipend while completing an approved skill programme.', benefitText: '₹3,000 a month during training', benefitValue: 36000, goal: 'employment', deadline: day(21), isDemo: true,
    rules: [R('age', 'between', [18, 35], 'Age'), R('income', 'lte', 500000, 'Family income'), R('occupation', 'in', ['jobseeker', 'student'], 'Who it is for')], documents: ['Aadhaar', 'Education certificate', 'Bank passbook'] },
  { slug: 'senior-citizen-pension', name: 'Senior Citizen Monthly Pension', department: 'Dept. of Social Welfare', category: 'Senior Citizens', summary: 'Monthly pension for senior citizens with low household income.', benefitText: '₹2,000 a month', benefitValue: 24000, goal: 'pension', deadline: day(144), isDemo: true,
    rules: [R('age', 'between', [60, 120], 'Age'), R('income', 'lte', 150000, 'Family income')], documents: ['Aadhaar', 'Age proof', 'Income certificate', 'Bank passbook'] },
  { slug: 'affordable-housing-subsidy', name: 'Affordable Housing Interest Subsidy', department: 'Ministry of Housing', category: 'Housing', summary: 'Interest subsidy on home loans for first-time buyers.', benefitText: 'Interest subsidy up to ₹2.67 lakh', benefitValue: 267000, goal: 'housing', deadline: day(175), isDemo: true,
    rules: [R('age', 'between', [21, 70], 'Age'), R('income', 'lte', 1800000, 'Family income')], documents: ['Aadhaar', 'Income certificate', 'Address proof', 'Bank passbook'] },
];

/** Starter records transcribed from public myScheme detail pages; unresolved rules deliberately remain unknown. */
export const OFFICIAL_MYSCHEME_SCHEMES: SchemeInput[] = [
  {
    slug: 'indira-gandhi-national-disability-pension-scheme',
    name: 'Indira Gandhi National Disability Pension Scheme',
    department: 'Ministry of Rural Development', category: 'Social Welfare', summary: 'A monthly pension under the National Social Assistance Programme for people with disabilities from families below the poverty line.',
    benefitText: 'Monthly pension; amount depends on current programme and state implementation', benefitValue: 0, goal: 'pension',
    sourceUrl: 'https://www.myscheme.gov.in/schemes/igndps', isDemo: false,
    rules: [R('age', 'gte', 19, 'Minimum age'), R('category', 'manual', 'Requires disability of 80% or more and BPL-family status. Confirm current state implementation and pension amount with the department.', 'Additional eligibility to confirm')],
    documents: [],
  },
  {
    slug: 'market-development-assistance-organic-fertilizer',
    name: 'Market Development Assistance',
    department: 'Ministry of Chemicals and Fertilizers', category: 'Agriculture', summary: 'Supports the sale of specified organic fertilizers produced at Bio-Gas and Compressed Bio-Gas plants under the GOBARdhan initiative.',
    benefitText: '₹1,500 per metric tonne for eligible organic fertilizers', benefitValue: 1500, goal: 'agriculture',
    sourceUrl: 'https://www.myscheme.gov.in/schemes/mda-fert', isDemo: false,
    rules: [R('category', 'manual', 'Manufacturing units must register on the GOBARdhan portal and products must conform to Fertilizer Control Order specifications.', 'Unit and product conditions to confirm')],
    documents: [],
  },
  {
    slug: 'right-to-information-fellowship',
    name: 'Right To Information Fellowship',
    department: 'Ministry of Personnel, Public Grievances and Pensions', category: 'Research and Fellowship', summary: 'Short-term fellowships for field-based research on the implementation of the Right to Information Act.',
    benefitText: 'Short-term research fellowship; amount not stated in the myScheme summary', benefitValue: 0, goal: 'education',
    sourceUrl: 'https://www.myscheme.gov.in/schemes/rtif', isDemo: false,
    rules: [R('category', 'manual', 'The myScheme page describes applicants from media, civil society, or RTI training backgrounds. Confirm the current call and detailed criteria with the department.', 'Applicant background to confirm')],
    documents: [],
  },
  {
    slug: 'national-post-doctoral-fellowship',
    name: 'National Post Doctoral Fellowship',
    department: 'Ministry of Science and Technology', category: 'Research and Fellowship', summary: 'A Science and Engineering Research Board fellowship for researchers working with a mentor in frontier areas of science and engineering; the listed tenure is two years.',
    benefitText: 'Two-year fellowship; current award amount not stated in the myScheme summary', benefitValue: 0, goal: 'education',
    sourceUrl: 'https://www.myscheme.gov.in/schemes/n-pdf', isDemo: false,
    rules: [R('category', 'manual', 'Confirm doctoral qualification, age limits, mentor and host-institution conditions in the current fellowship call.', 'Current call criteria to confirm')],
    documents: [],
  },
  {
    slug: 'dnh-dd-widow-pension-scheme',
    name: 'Pension Scheme to Widow - DNH & DD',
    department: 'Social Welfare Department', category: 'Social Welfare', level: 'state', states: ['Dadra and Nagar Haveli and Daman and Diu'],
    summary: 'The myScheme listing describes financial assistance for widows aged 18 to 59 in Dadra and Nagar Haveli and Daman and Diu.',
    benefitText: '₹1,000 per month as listed on myScheme', benefitValue: 12000, goal: 'pension',
    sourceUrl: 'https://www.myscheme.gov.in/schemes/psw', isDemo: false,
    rules: [R('age', 'between', [18, 59], 'Age'), R('category', 'manual', 'Confirm widow status, residence proof, and current local application requirements with the Social Welfare Department.', 'Local conditions to confirm')],
    documents: [],
  },
  {
    slug: 'tn-cooperative-bank-power-tiller-loan',
    name: 'Primary Cooperative Agriculture and Rural Development Bank: For Power Tiller',
    department: 'Co-operation, Food and Consumer Protection Department, Tamil Nadu', category: 'Agriculture and Rural Development', level: 'state', states: ['Tamil Nadu'],
    summary: 'A loan for farmers purchasing a power tiller, with the myScheme listing stating coverage of up to 90% of cost and an interest rate between 11% and 12.25%.',
    benefitText: 'Loan may cover up to 90% of power-tiller cost; listed interest 11%–12.25%', benefitValue: 0, goal: 'agriculture',
    sourceUrl: 'https://www.myscheme.gov.in/schemes/pcardbpt', isDemo: false,
    rules: [R('category', 'manual', 'Confirm Tamil Nadu residency, farmer status, bank membership and current loan conditions with the cooperative bank.', 'Loan conditions to confirm')],
    documents: [],
  },
  {
    slug: 'prime-minister-employment-generation-programme',
    name: 'Prime Minister Employment Generation Programme (PMEGP)',
    department: 'Ministry of Micro, Small and Medium Enterprises', category: 'Entrepreneurship and Finance',
    summary: 'A credit-linked subsidy programme supporting the establishment of new micro-enterprises in the non-farm sector.',
    benefitText: 'Project cost ceilings listed: ₹50 lakh manufacturing and ₹20 lakh business/service; subsidy varies by applicant and location', benefitValue: 0, goal: 'business',
    sourceUrl: 'https://www.msme.gov.in/offerings/schemes-and-services/details/prime-minister-employment-generation-programme-and-other-credit-support-schemes-1-MDMzETMtQWa', isDemo: false,
    rules: [R('age', 'gte', 19, 'Minimum age'), R('category', 'manual', 'Additional education requirements depend on project cost. Existing units and units that already received government subsidy are generally excluded; confirm exceptions and current guidelines.', 'Project and prior-assistance conditions to confirm')],
    documents: [],
  },
  {
    slug: 'credit-guarantee-scheme-micro-small-enterprises',
    name: 'Credit Guarantee Scheme for Micro and Small Enterprises (CGTMSE)',
    department: 'Ministry of Micro, Small and Medium Enterprises', category: 'Entrepreneurship and Finance',
    summary: 'Credit guarantee support for eligible micro and small enterprise loans through member lending institutions, without collateral security or third-party guarantee.',
    benefitText: 'Credit guarantee support for eligible loans up to ₹10 crore; this is a guarantee limit, not a grant', benefitValue: 0, goal: 'business',
    sourceUrl: 'https://dcmsme.gov.in/CLCS_TUS_Scheme/Credit_Guarantee_Scheme/Scheme_Guidelines.aspx', isDemo: false,
    rules: [R('category', 'manual', 'Eligibility, guarantee coverage, fees and lender participation depend on current CGTMSE guidelines. Confirm with a member lending institution.', 'Lender and guarantee conditions to confirm')],
    documents: [],
  },
  {
    slug: 'interest-subsidy-eligibility-certificate-khadi',
    name: 'Interest Subsidy Eligibility Certificate (ISEC)',
    department: 'Ministry of Micro, Small and Medium Enterprises', category: 'Entrepreneurship and Finance',
    summary: 'A concessional working-capital credit programme for eligible Khadi institutions; the official Ministry page lists a 4% borrower interest rate, with the differential reimbursed to lending banks through KVIC.',
    benefitText: 'Concessional working-capital credit at 4% interest for eligible Khadi institutions', benefitValue: 0, goal: 'business',
    sourceUrl: 'https://www.msme.gov.in/offerings/schemes-and-services/details/prime-minister-employment-generation-programme-and-other-credit-support-schemes-1-MDMzETMtQWa', isDemo: false,
    rules: [R('category', 'manual', 'For Khadi institutions with a valid Khadi certificate and sanctioned Khadi programme; confirm current registration and lending-bank requirements.', 'Institution conditions to confirm')],
    documents: [],
  },
];

export async function seed(db: Db, cfg: Config) {
  for (const s of OFFICIAL_MYSCHEME_SCHEMES) {
    const exists = await db.query('select id from schemes where slug=$1', [s.slug]);
    if (!exists.length) {
      const id = await saveScheme(db, s, { status: 'published' });
      await db.query('update schemes set source_key=$2,source_record_id=$3 where id=$1', [id, 'myscheme-curated', s.slug]);
    }
  }
  if (cfg.SEED_DEMO) {
    for (const s of DEMO_SCHEMES()) {
      const exists = await db.query('select 1 from schemes where slug=$1', [s.slug]);
      if (!exists.length) await saveScheme(db, s, { status: 'published' });
    }
  }
  if (cfg.ADMIN_EMAIL && cfg.ADMIN_PASSWORD) {
    const hash = await bcrypt.hash(cfg.ADMIN_PASSWORD, 12);
    await db.query(`insert into users(email,password_hash,name,role) values($1,$2,'Admin','admin') on conflict(email) do update set role='admin'`, [cfg.ADMIN_EMAIL.toLowerCase(), hash]);
  }
}
