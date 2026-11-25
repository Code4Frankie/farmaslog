// Starter wording for the privacy notice and terms pages. PURE module. These are a starting point for the administrator to
// edit and for a lawyer to review; nothing here is public until an administrator publishes a page. Placeholders ({{email}} and
// so on) are filled from the consent contact details.
export const PAGE_SLUGS = ['privacy', 'terms'];
export const PAGE_NAMES = { privacy: 'Privacy notice', terms: 'Terms of use' };

export const STARTERS = {
  privacy: {
    title: 'FarmasLog privacy notice',
    sections: [
      { heading: 'Who we are', body: 'FarmasLog is run by Frankiecode Solutions, {{registeredAddress}}. Contact us at {{email}}, {{phone}} or {{whatsapp}}.' },
      { heading: 'What this notice covers', body: 'How we collect and use information about farmers, partner organisations and the people who use this website.' },
      { heading: 'Farmers: what we collect', body: 'Name, phone number or the contact of someone who can reach you, state, local government area and community, main crop, farm size and farm location. You may also choose to tell us your gender, age group and whether you live with a disability. We do not ask for BVN, NIN, bank details, date of birth or proof of land ownership.' },
      { heading: 'Why we use it', body: 'To keep a record of smallholder farmers so that approved organisations can check that a farmer exists and how well the record is backed up. We do not sell personal data.' },
      { heading: 'Who sees it', body: 'FarmasLog staff and field agents who need it to do their work. Approved partner organisations can check whether a record exists and see limited details. They do not see gender, age group or disability.' },
      { heading: 'Your consent and your rights', body: 'We ask for your agreement before keeping your record. You can ask to see it, correct it, withdraw consent or have it deleted by contacting us. If you withdraw, we stop sharing your record with partners. You can complain to the Nigeria Data Protection Commission.' },
      { heading: 'How long we keep it', body: 'While your record is active, and up to {{retention}} after that, unless you ask us to delete it sooner or the law requires us to keep it.' },
      { heading: 'Where data is stored and who helps us', body: 'Data is stored on {{hosting}}. Service providers help us send text messages and protect the website from abuse. They receive only what they need to do that.' },
      { heading: 'Partners and website visitors', body: 'Partner organisations: we keep the details you give us when you ask for access, and a log of the checks you make. Website visitors: we do not use advertising trackers.' },
      { heading: 'Changes to this notice', body: 'When we change this notice we publish the new version here with its date.' },
    ],
  },
  terms: {
    title: 'FarmasLog terms of use',
    sections: [
      { heading: 'About these terms', body: 'These terms apply to your use of the FarmasLog website and service, run by Frankiecode Solutions. Contact: {{email}}.' },
      { heading: 'What FarmasLog is', body: 'A record of smallholder farmers that approved organisations can check. A record shows how strong the evidence is. Being on FarmasLog does not guarantee a loan, insurance or any programme benefit; each organisation makes its own decisions.' },
      { heading: 'Farmers', body: 'Registering is voluntary and free. Give true information. You can ask us to correct or remove your record at any time.' },
      { heading: 'Partner organisations', body: 'Partners may use verification results only for the purpose they were approved for, must keep API keys secret, and must not try to identify farmers by guessing or repeated searches. We may suspend access that breaks these terms.' },
      { heading: 'Field agents', body: 'Agents may collect information only with the farmer\'s agreement, and must record it accurately. A record is marked verified only after an agent visits the farm.' },
      { heading: 'Acceptable use', body: 'Do not attempt to break into the service, overload it, or collect data from it in bulk.' },
      { heading: 'No guarantee', body: 'We work to keep the service accurate and available but cannot promise it will always be error-free or uninterrupted.' },
      { heading: 'Changes', body: 'We may update these terms. The version published here is the one that applies.' },
    ],
  },
};
