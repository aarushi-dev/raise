import * as React from "react"

import Page from "../components/Page"
import Section from "../components/Section"
import logo from "../images/logo.png"
import Button from "../components/Button"

const NotFoundPage = () => (
  <Page>
    <Section>
      <img alt="" src={logo} height={60} width={95} className="mb-8" />
      <h1 className="text-5xl sm:text-6xl font-raise-header font-black mb-8">Raise: Page not found</h1>
      <p>We couldn't find the page you requested.</p>
      <Button to="/" variant="red" className="inline-block mt-4">View homepage</Button>
    </Section>
  </Page>
)

export default NotFoundPage